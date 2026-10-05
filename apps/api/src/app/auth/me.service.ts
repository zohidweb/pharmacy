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
import { ProblemException } from '../../common/errors/problem.exception';
import { PasswordHasher, SessionTokenService } from '../../core/crypto';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { type SessionRecord, SessionStore } from '../../core/sessions';
import { AuditService } from '../audit/audit.service';
import { EmployeeAuthRepository } from './employee-auth.repository';
import { dbLanguage, roleDisplayName } from './session-profile';

/** The rotated session of a password change: the JWT for the cookie, never in a body or a log. */
export interface PasswordChangeResult {
  token: string;
  maxAgeSeconds: number;
}

const invalidCredentials = () =>
  new ProblemException(401, 'invalid_credentials');
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
      // Last inside the transaction: if the session cannot be updated, the language rolls back.
      await this.sessions.update(principal.sessionId, { locale });
      return this.buildMe(trx, principal, locale);
    });
  }

  /**
   * Order: the current password is verified (401 `invalid_credentials`; no padding - the employee
   * is known and signed in, guessing is limited by the principal throttler), then the policy of
   * the new one (422), then the hash, the audit and the new session commit together. After the
   * commit the old session and every other session of the employee are destroyed; a failure there
   * is logged, not returned: the password has already changed.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<PasswordChangeResult> {
    const principal = requirePrincipal();
    const { tenantId, employeeId } = principal;

    const credentials = await this.db.tenantTransaction((trx) =>
      this.repository.findCredentials(trx, tenantId, employeeId),
    );
    if (credentials === null) throw unauthenticated();
    const { passwordHash: phc, passwordPepperVersion: pepperVersion } =
      credentials;
    if (phc === null || pepperVersion === null) throw invalidCredentials();
    if (!(await this.hasher.verify(currentPassword, phc, pepperVersion))) {
      throw invalidCredentials();
    }

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
    });

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
