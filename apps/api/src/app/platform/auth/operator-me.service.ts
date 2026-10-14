import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passwordProblems } from '@pharmacy/shared-domain';
import type {
  OperatorMe,
  OperatorSessionInfo,
  UiLocale,
} from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requireOperator,
} from '../../../common/context/request-context';
import { afterCommitBestEffort } from '../../../common/errors/after-commit';
import {
  LockedException,
  ProblemException,
} from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import {
  PasswordHasher,
  SessionTokenService,
  sha256Hex,
} from '../../../core/crypto';
import { PlatformDatabase } from '../../../core/database/platform';
import {
  type OperatorSessionRecord,
  OperatorSessionStore,
} from '../../../core/sessions';
import { LoginLimiter } from '../../auth/login-limiter';
import { dbLanguage } from '../../auth/session-profile';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { OperatorAuthRepository } from './operator-auth.repository';
import { operatorMe } from './operator-profile';

/** The rotated session of a password change: the JWT for the cookie, never in a body or a log. */
export interface OperatorPasswordChangeResult {
  token: string;
  maxAgeSeconds: number;
}

// A wrong current password is a field error of a signed-in operator (422): ADR-0015 reserves 401
// for a lost session, which the admin answers by going to the sign-in page.
const invalidCurrentPassword = () =>
  new FieldProblemException(422, 'invalid_current_password', [
    { field: 'currentPassword', code: 'invalid_current_password' },
  ]);
// The operator of a live session is gone or disabled: no profile to show.
const unauthenticated = () => new ProblemException(401, 'unauthenticated');

// An opaque id of a session for the list: the session id itself is the jti of the token and is
// not handed out.
const listId = (sessionId: string): string => sha256Hex(sessionId).slice(0, 16);

// The own profile, interface language, password and sessions of the signed-in operator (auth
// design 2026-10-02, section 9), as MeService does for an employee. The operator comes from the
// principal, never from the request. Passwords, hashes and tokens are never logged or audited.
@Injectable()
export class OperatorMeService {
  private readonly logger = new Logger(OperatorMeService.name);
  private readonly absoluteTtlSeconds: number;

  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: OperatorAuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SessionTokenService,
    private readonly sessions: OperatorSessionStore,
    private readonly limiter: LoginLimiter,
    private readonly audit: PlatformAuditService,
    config: ConfigService,
  ) {
    this.absoluteTtlSeconds = config.getOrThrow<number>(
      'OPERATOR_SESSION_ABSOLUTE_SECONDS',
    );
  }

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  async get(): Promise<OperatorMe> {
    const actor = this.actor();
    const profile = await this.db.platformTransaction(actor, (trx) =>
      this.repository.findProfile(trx, actor.operatorId),
    );
    if (profile === null) throw unauthenticated();
    return operatorMe(profile);
  }

  /** The name and the interface language; the admin applies the language itself. */
  async update(fullName: string, locale: UiLocale): Promise<OperatorMe> {
    const actor = this.actor();
    const profile = await this.db.platformTransaction(actor, async (trx) => {
      await this.repository.updateProfile(trx, actor.operatorId, {
        fullName,
        language: dbLanguage(locale),
      });
      return this.repository.findProfile(trx, actor.operatorId);
    });
    if (profile === null) throw unauthenticated();
    return operatorMe(profile);
  }

  /**
   * As an employee's change (MeService.changePassword): an attempt is reserved with the limiter
   * (429 `login_locked`: 5 attempts / 900 s, keyed by the operator, so a hijacked session cannot
   * guess the current password), the current password is verified (422 `invalid_current_password`
   * on the field `currentPassword`), then the policy of the new one (422 `password_policy`), then
   * the hash, the audit and the new session commit together; after the commit every other session
   * of the operator ends. No step-up: the current password is the confirmation (an operator has no
   * re-confirmation route, and a fresh sign-in would ask for the same password).
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<OperatorPasswordChangeResult> {
    const principal = requireOperator();
    const { operatorId } = principal;
    const actor = { kind: 'operator' as const, operatorId };

    // The attempt is reserved atomically before any hashing or database call (see LoginLimiter).
    const limiterKey = `password-change:operator:${operatorId}`;
    const attempt = await this.limiter.tryAcquire(limiterKey);
    if (!attempt.allowed) {
      throw new LockedException(429, 'login_locked', attempt.retryAfterSeconds);
    }

    const credentials = await this.db.platformTransaction(actor, (trx) =>
      this.repository.findCredentials(trx, operatorId),
    );
    if (credentials === null || credentials.status !== 'active')
      throw unauthenticated();
    const { passwordHash: phc, passwordPepperVersion: pepperVersion } =
      credentials;
    if (phc === null || pepperVersion === null) throw invalidCurrentPassword();
    if (!(await this.hasher.verify(currentPassword, phc, pepperVersion))) {
      throw invalidCurrentPassword();
    }
    await this.limiter.reset(limiterKey);

    if (passwordProblems(newPassword).length > 0) {
      throw new ProblemException(422, 'password_policy');
    }

    // The new session continues the old one (device, idle lifetime); the id and the password
    // authentication time are new.
    const previous = await this.sessions.lookup(
      principal.sessionId,
      operatorId,
    );
    if (previous === null) throw unauthenticated();

    // No transaction is held open during scrypt.
    const next = await this.hasher.hash(newPassword);

    const now = Date.now();
    const sessionId = randomUUID();
    const token = await this.tokens.signOperator(
      { jti: sessionId, sub: operatorId },
      this.absoluteTtlSeconds,
    );
    const authenticatedAt = new Date(now).toISOString();
    const record: OperatorSessionRecord = {
      ...previous,
      sessionId,
      authenticatedAt,
      absoluteExpiresAt: new Date(
        now + this.absoluteTtlSeconds * 1000,
      ).toISOString(),
      lastSeenAt: authenticatedAt,
    };

    const stored = { session: false };
    try {
      await this.db.platformTransaction(actor, async (trx) => {
        const changed = await this.repository.changePassword(
          trx,
          operatorId,
          phc,
          next,
        );
        // The stored hash is not the verified one any more: the password changed meanwhile.
        if (!changed) throw new ProblemException(409, 'conflict');
        await this.audit.append(trx, {
          action: 'auth.operator-password-changed',
          entityType: 'operator',
          entityId: operatorId,
        });
        // Last inside the transaction: if the session cannot be stored, the password rolls back.
        await this.sessions.create(record);
        stored.session = true;
      });
    } catch (error) {
      // A commit that fails after the new session was stored leaves it with no password behind
      // it; nobody holds its token, so it is removed rather than left to expire.
      if (stored.session) await this.discard(sessionId);
      throw error;
    }

    // The password has changed, so a failure here is logged, not answered; each step is attempted
    // whatever the other did.
    await afterCommitBestEffort(
      this.logger,
      'Ending the replaced session',
      () => this.sessions.destroy(principal.sessionId),
    );
    await afterCommitBestEffort(this.logger, 'Ending the other sessions', () =>
      this.sessions.destroyAllFor(operatorId, sessionId),
    );
    return { token, maxAgeSeconds: this.absoluteTtlSeconds };
  }

  /** The live sessions of the operator: the current one first, then by the last request. */
  async sessionList(): Promise<OperatorSessionInfo[]> {
    const { operatorId, sessionId } = requireOperator();
    const records = await this.sessions.listFor(operatorId);
    return records
      .map((record) => ({
        id: listId(record.sessionId),
        device: record.device ?? '',
        lastSeenAt: record.lastSeenAt ?? record.authenticatedAt,
        current: record.sessionId === sessionId,
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) ||
          b.lastSeenAt.localeCompare(a.lastSeenAt),
      );
  }

  /** Ends every session of the operator except the current one. */
  async endOtherSessions(): Promise<void> {
    const { operatorId, sessionId } = requireOperator();
    await this.sessions.destroyAllFor(operatorId, sessionId);
  }

  private async discard(sessionId: string): Promise<void> {
    try {
      await this.sessions.destroy(sessionId);
    } catch (error) {
      this.logger.warn(
        `Uncommitted operator session was not removed (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
  }
}
