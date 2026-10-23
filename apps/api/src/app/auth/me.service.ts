import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passwordProblems } from '@pharmacy/shared-domain';
import type { EmployeeMe, UiLocale } from '@pharmacy/shared-dto';
import {
  type EmployeePrincipal,
  getRequestContext,
  requirePrincipal,
} from '../../common/context/request-context';
import {
  LockedException,
  ProblemException,
} from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { PasswordHasher, SessionTokenService } from '../../core/crypto';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { type SessionRecord, SessionStore } from '../../core/sessions';
import { AuditService } from '../audit/audit.service';
import { EmployeeAuthRepository } from './employee-auth.repository';
import { LoginLimiter } from './login-limiter';
import { dbLanguage, roleDisplayName } from './session-profile';
import {
  passwordChangeLimiterKey,
  placedLock,
  SignInLocks,
} from './sign-in-locks';

/** The rotated session of a password change: the JWT for the cookie, never in a body or a log. */
export interface PasswordChangeResult {
  token: string;
  maxAgeSeconds: number;
}

// A wrong current password is a field error of a signed-in employee (422): ADR-0015 reserves 401
// for a lost session, which the client answers by going to the sign-in page.
const invalidCurrentPassword = () =>
  new FieldProblemException(422, 'invalid_current_password', [
    { field: 'currentPassword', code: 'invalid_current_password' },
  ]);
// The employee of a live session is gone: no profile to show.
const unauthenticated = () => new ProblemException(401, 'unauthenticated');

// The own profile, interface language and password of the signed-in employee (auth design
// 2026-10-02, section 6). The tenant and the employee come from the principal, never from the
// request. Passwords, hashes and tokens are never logged or audited.
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);
  private readonly absoluteTtlSeconds: number;

  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: EmployeeAuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SessionTokenService,
    private readonly sessions: SessionStore,
    private readonly limiter: LoginLimiter,
    private readonly locks: SignInLocks,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.absoluteTtlSeconds = config.getOrThrow<number>(
      'SESSION_ABSOLUTE_TTL_SECONDS',
    );
  }

  async get(): Promise<EmployeeMe> {
    const principal = requirePrincipal();
    return this.db.tenantTransaction((trx) =>
      this.buildMe(trx, principal, principal.locale),
    );
  }

  /** Changes `employees.language` and the locale of the current session. */
  async updateLocale(locale: UiLocale): Promise<EmployeeMe> {
    const principal = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      await this.repository.updateLanguage(
        trx,
        principal.tenantId,
        principal.employeeId,
        dbLanguage(locale),
      );
      const me = await this.buildMe(trx, principal, locale);
      // Last inside the transaction: if the session cannot be updated, the language rolls back. Only
      // the commit itself can still fail after it, leaving the session ahead by a locale.
      await this.sessions.update(principal.sessionId, { locale });
      return me;
    });
  }

  /**
   * Order: an attempt is reserved with the limiter (429 `login_locked` while locked: the same
   * 5 attempts / 900 s policy as the sign-in, keyed by the employee, so a hijacked fresh session
   * cannot guess the current password; then one attempt of the account budget shared with the
   * sign-in), the current password is verified (422
   * `invalid_current_password` on the field `currentPassword`; no padding - the employee is known
   * and signed in), then the policy of the new one (422), then the hash, the audit and the new
   * session commit together. After the commit the old session and every other session of the
   * employee are destroyed; a failure there is logged, not returned: the password has already
   * changed. The limiter is reset as soon as the current password is verified, so a rejected new
   * password does not eat attempts.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<PasswordChangeResult> {
    const principal = requirePrincipal();
    const { tenantId, employeeId } = principal;

    // The attempt is reserved atomically before any hashing or database call (see LoginLimiter).
    const limiterKey = passwordChangeLimiterKey(tenantId, employeeId);
    const attempt = await this.limiter.tryAcquire(limiterKey);
    if (!attempt.allowed)
      throw new LockedException(429, 'login_locked', attempt.retryAfterSeconds);
    // The account budget is shared with the sign-in and the confirmation (security review A2).
    const account = await this.locks.reserveAccount(tenantId, employeeId);
    if (!account.allowed) {
      await this.locks.record(
        employeeId,
        placedLock(attempt, 'password-change'),
      );
      throw new LockedException(429, 'login_locked', account.retryAfterSeconds);
    }
    // The locks this attempt placed are written when it ends without a verified password, an
    // unexpected error included (P2).
    const locks = [
      ...placedLock(attempt, 'password-change'),
      ...placedLock(account, 'account'),
    ];
    const failed = async (error: unknown): Promise<never> => {
      await this.locks.record(employeeId, locks);
      throw error;
    };

    const credentials = await this.db
      .tenantTransaction((trx) =>
        this.repository.findCredentials(trx, tenantId, employeeId),
      )
      .catch(failed);
    // A blocked employee whose session has not ended yet does not change the password.
    if (credentials === null || credentials.status !== 'active') {
      return failed(unauthenticated());
    }
    const { passwordHash: phc, passwordPepperVersion: pepperVersion } =
      credentials;
    if (phc === null || pepperVersion === null) {
      return failed(invalidCurrentPassword());
    }
    const verified = await this.hasher
      .verify(currentPassword, phc, pepperVersion)
      .catch(failed);
    if (!verified) return failed(invalidCurrentPassword());
    await this.limiter.reset(limiterKey);
    await this.locks.resetAccount(tenantId, employeeId);

    if (passwordProblems(newPassword).length > 0) {
      throw new ProblemException(422, 'password_policy');
    }

    // The new session continues the old one (scope, store, locale, permissions snapshot); the
    // session id and the password authentication time are new.
    const { session: previous } = await this.sessions.lookup(
      principal.sessionId,
      tenantId,
      employeeId,
    );
    if (previous === null) throw unauthenticated();

    // No transaction is held open during scrypt.
    const next = await this.hasher.hash(newPassword);

    const now = Date.now();
    const sessionId = randomUUID();
    const token = await this.tokens.sign(
      { jti: sessionId, sub: employeeId, tid: tenantId, aud: 'web' },
      this.absoluteTtlSeconds,
    );
    const record: SessionRecord = {
      ...previous,
      sessionId,
      auth: 'password',
      authenticatedAt: new Date(now).toISOString(),
      absoluteExpiresAt: new Date(
        now + this.absoluteTtlSeconds * 1000,
      ).toISOString(),
    };

    const stored = { session: false };
    try {
      await this.db.tenantTransaction(async (trx) => {
        const changed = await this.repository.changePassword(
          trx,
          tenantId,
          employeeId,
          phc,
          next,
        );
        // The stored hash is not the verified one any more: the password changed meanwhile.
        if (!changed) throw new ProblemException(409, 'conflict');
        await this.audit.append(trx, {
          action: 'auth.password-changed',
          entityType: 'employee',
          entityId: employeeId,
        });
        // Last inside the transaction: if the session cannot be stored, the password rolls back.
        await this.sessions.create(record);
        stored.session = true;
      });
    } catch (error) {
      // A commit that fails after the new session was stored leaves it with no password behind
      // it; nobody holds its token, so it is removed rather than left to expire.
      if (stored.session) {
        try {
          await this.sessions.destroy(sessionId);
        } catch (cleanup) {
          this.logDestroyFailure('the uncommitted session', cleanup);
        }
      }
      throw error;
    }

    await this.endPreviousSessions(principal, sessionId);
    return { token, maxAgeSeconds: this.absoluteTtlSeconds };
  }

  // After the commit. Each step is attempted whatever the other did; a failure is logged with the
  // correlation id (the error name only: a message may carry values), never returned.
  private async endPreviousSessions(
    principal: EmployeePrincipal,
    newSessionId: string,
  ): Promise<void> {
    try {
      await this.sessions.destroy(principal.sessionId);
    } catch (error) {
      this.logDestroyFailure('the replaced session', error);
    }
    try {
      await this.sessions.destroyAllFor(
        principal.tenantId,
        principal.employeeId,
        newSessionId,
      );
    } catch (error) {
      this.logDestroyFailure('the other sessions', error);
    }
  }

  private logDestroyFailure(what: string, error: unknown): void {
    const name = error instanceof Error ? error.name : typeof error;
    this.logger.error(
      `Could not destroy ${what} after a password change (${name}) [correlationId=${getRequestContext()?.correlationId}]`,
    );
  }

  private async buildMe(
    trx: TenantTransaction,
    principal: EmployeePrincipal,
    locale: UiLocale,
  ): Promise<EmployeeMe> {
    const { tenantId, employeeId } = principal;
    const profile = await this.repository.loadProfile(
      trx,
      tenantId,
      employeeId,
    );
    const extras = await this.repository.loadMeExtras(
      trx,
      tenantId,
      employeeId,
    );
    if (profile === null || extras === null) throw unauthenticated();
    const stores = await this.repository.activeStores(
      trx,
      tenantId,
      principal.storeScope,
    );
    return {
      id: profile.employee.id,
      fullName: profile.employee.fullName,
      login: profile.employee.login,
      phone: profile.employee.phone ?? '',
      roleName: roleDisplayName(profile.role.name, locale),
      scope: principal.storeScope === 'all' ? 'network' : 'stores',
      storeNames: stores.map((store) => store.name),
      lastLoginAt: extras.lastLoginAt?.toISOString() ?? null,
      locale,
      pinSet: extras.pinSet,
    };
  }
}
