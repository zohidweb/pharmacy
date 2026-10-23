import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OperatorSession } from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requireOperator,
} from '../../../common/context/request-context';
import {
  LockedException,
  ProblemException,
} from '../../../common/errors/problem.exception';
import { PasswordHasher, SessionTokenService, sha256Hex } from '../../../core/crypto';
import { PlatformDatabase } from '../../../core/database/platform';
import { OperatorSessionStore } from '../../../core/sessions';
import { normalizeIdentifier } from '../../auth/identifier';
import { LoginClock, padFailure } from '../../auth/login-clock';
import { LoginLimiter } from '../../auth/login-limiter';
import { PlatformAuditService } from '../audit/platform-audit.service';
import {
  OperatorAuthRepository,
  type OperatorProfileRow,
} from './operator-auth.repository';
import { deviceLabel } from './device-label';
import { operatorSession } from './operator-profile';

export interface OperatorLoginResult {
  /** Operator JWT for the cookie; never in a response body or a log. */
  token: string;
  maxAgeSeconds: number;
  session: OperatorSession;
}

type FailureReason =
  | 'unknown_login'
  | 'invalid_password'
  | 'no_password'
  | 'operator_blocked'
  | 'password_changed';

const SIGN_IN_JOB = { kind: 'system', job: 'operator-auth' } as const;

// The operator of a verified password is gone between the check and the session.
class OperatorGoneError extends Error {
  constructor() {
    super('The operator of a verified password is gone');
    this.name = 'OperatorGoneError';
  }
}

// The operator was disabled between the check and the session.
class OperatorBlockedError extends Error {
  constructor() {
    super('The operator was disabled during the sign-in');
    this.name = 'OperatorBlockedError';
  }
}

// The password was changed (or set by a code) between the check and the session: the verified
// password is not the operator's any more.
class PasswordChangedError extends Error {
  constructor() {
    super('The password changed during the sign-in');
    this.name = 'PasswordChangedError';
  }
}

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

// One answer for every failure: an unknown login and a wrong password are indistinguishable.
const invalidCredentials = () => new ProblemException(401, 'invalid_credentials');

// Sign-in, the current session and sign-out of a platform operator (auth design 2026-10-02,
// section 9). The same rules as employee sign-in (section 6): limiter before hashing, a dummy
// hash for an unknown login, every failure padded to the floor. Passwords, hashes, tokens and
// login values are never logged or audited.
@Injectable()
export class OperatorSessionsService {
  private readonly logger = new Logger(OperatorSessionsService.name);
  private readonly idleTtlSeconds: number;
  private readonly absoluteTtlSeconds: number;
  private readonly failureFloorMs: number;

  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: OperatorAuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SessionTokenService,
    private readonly sessions: OperatorSessionStore,
    private readonly limiter: LoginLimiter,
    private readonly audit: PlatformAuditService,
    private readonly clock: LoginClock,
    config: ConfigService,
  ) {
    this.idleTtlSeconds = config.getOrThrow<number>('OPERATOR_SESSION_IDLE_SECONDS');
    this.absoluteTtlSeconds = config.getOrThrow<number>(
      'OPERATOR_SESSION_ABSOLUTE_SECONDS',
    );
    this.failureFloorMs = config.getOrThrow<number>('LOGIN_FAILURE_FLOOR_MS');
  }

  async login(
    raw: string,
    password: string,
    ip: string,
    userAgent: string | undefined,
  ): Promise<OperatorLoginResult> {
    const started = this.clock.now();
    try {
      return await this.attemptLogin(raw, password, ip, userAgent);
    } catch (error) {
      if (error instanceof ProblemException && error.code === 'invalid_credentials') {
        await padFailure(this.clock, this.failureFloorMs, started);
      }
      throw error;
    }
  }

  async current(): Promise<OperatorSession> {
    const operator = requireOperator();
    const profile = await this.db.platformTransaction(
      { kind: 'operator', operatorId: operator.operatorId },
      (trx) => this.repository.findProfile(trx, operator.operatorId),
    );
    if (profile === null) throw new ProblemException(401, 'unauthenticated');
    return operatorSession(profile, operator.authenticatedAt);
  }

  async logout(): Promise<void> {
    await this.sessions.destroy(requireOperator().sessionId);
  }

  private async attemptLogin(
    raw: string,
    password: string,
    ip: string,
    userAgent: string | undefined,
  ): Promise<OperatorLoginResult> {
    // An operator login is a work e-mail; anything else cannot match and spends no limiter key.
    const identifier = normalizeIdentifier(raw);
    if (identifier === null || identifier.kind !== 'email') {
      await this.hasher.verifyDummy(password);
      throw invalidCredentials();
    }
    const login = identifier.value;

    // The attempt is reserved atomically before any hashing or database call.
    const key = `operator:${sha256Hex(login)}`;
    const attempt = await this.limiter.tryAcquire(key);
    if (!attempt.allowed) throw new LockedException(429, 'login_locked', attempt.retryAfterSeconds);
    // A lock this attempt placed goes to the journal if the attempt fails (security review P2).
    const { lockSeconds } = attempt;

    const found = await this.db.platformTransaction(SIGN_IN_JOB, (trx) =>
      this.repository.findByLogin(trx, login),
    );

    // Exactly one scrypt check, the stored hash or the dummy one; no transaction held open.
    let ok = false;
    if (found?.passwordHash && found.passwordPepperVersion !== null) {
      ok = await this.hasher.verify(password, found.passwordHash, found.passwordPepperVersion);
    } else {
      await this.hasher.verifyDummy(password);
    }
    if (found === null) return this.fail(null, 'unknown_login', ip, lockSeconds);
    if (found.passwordHash === null) return this.fail(found.id, 'no_password', ip, lockSeconds);
    if (!ok) return this.fail(found.id, 'invalid_password', ip, lockSeconds);
    if (found.status !== 'active') return this.fail(found.id, 'operator_blocked', ip, lockSeconds);

    const operatorId = found.id;
    const verifiedPhc = found.passwordHash;
    const rehash =
      found.passwordPepperVersion !== null &&
      this.hasher.needsRehash(verifiedPhc, found.passwordPepperVersion)
        ? await this.hasher.hash(password)
        : null;

    const now = Date.now();
    const sessionId = randomUUID();
    const token = await this.tokens.signOperator(
      { jti: sessionId, sub: operatorId },
      this.absoluteTtlSeconds,
    );
    const authenticatedAt = new Date(now).toISOString();

    const stored = { session: false };
    let profile: OperatorProfileRow;
    try {
      profile = await this.db.platformTransaction(
        { kind: 'operator', operatorId },
        async (trx) => {
          // operators before operator_credentials, as in every writer of both (a new code, a
          // password change): the opposite order could deadlock with them.
          if (!(await this.repository.recordLogin(trx, operatorId))) {
            throw new OperatorBlockedError();
          }
          // A password changed after the check would otherwise leave this session alive: the
          // change ends the sessions it finds, and this one is stored only now.
          const current = await this.repository.lockPasswordChange(trx, operatorId);
          if (current === null || !sameInstant(current.changedAt, found.passwordChangedAt)) {
            throw new PasswordChangedError();
          }
          if (rehash !== null) {
            await this.repository.updatePasswordHash(trx, operatorId, verifiedPhc, rehash);
          }
          await this.audit.append(trx, {
            action: 'auth.operator-login-succeeded',
            entityType: 'operator',
            entityId: operatorId,
            details: { ip },
          });
          const row = await this.repository.findProfile(trx, operatorId);
          if (row === null) throw new OperatorGoneError();
          // Last inside the transaction: if the session cannot be stored, the audit rolls back.
          await this.sessions.create({
            sessionId,
            operatorId,
            authenticatedAt,
            idleTtlSeconds: this.idleTtlSeconds,
            absoluteExpiresAt: new Date(now + this.absoluteTtlSeconds * 1000).toISOString(),
            device: deviceLabel(userAgent),
            lastSeenAt: authenticatedAt,
          });
          stored.session = true;
          return row;
        },
      );
    } catch (error) {
      // A commit that fails after the session was stored leaves it with nothing behind it; nobody
      // holds its token, so it is removed rather than left to expire.
      if (stored.session) await this.discard(sessionId);
      // The operator of the verified password is gone: the same answer as an unknown login.
      if (error instanceof OperatorGoneError) return this.fail(operatorId, 'unknown_login', ip, lockSeconds);
      if (error instanceof OperatorBlockedError) {
        return this.fail(operatorId, 'operator_blocked', ip, lockSeconds);
      }
      if (error instanceof PasswordChangedError) {
        return this.fail(operatorId, 'password_changed', ip, lockSeconds);
      }
      throw error;
    }

    await this.limiter.reset(key);
    return {
      token,
      maxAgeSeconds: this.absoluteTtlSeconds,
      session: operatorSession(profile, authenticatedAt),
    };
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

  // A failed sign-in (already counted by tryAcquire): audited on the platform with the lock the
  // attempt placed, if any (security review P2), answered as 401.
  private async fail(
    operatorId: string | null,
    reason: FailureReason,
    ip: string,
    lockSeconds: number | undefined,
  ): Promise<never> {
    // An unknown login goes to the application log only, without the value: platform_audit_log is
    // append-only, and rotating unknown e-mails would otherwise fill it without bound. Failures of
    // a known operator are bounded by the per-login limiter.
    if (operatorId === null) {
      this.logger.warn(
        `Operator sign-in failed: unknown login [correlationId=${getRequestContext()?.correlationId}]`,
      );
      if (lockSeconds !== undefined) {
        this.logger.warn(
          `Operator sign-in locked: unknown login [correlationId=${getRequestContext()?.correlationId}]`,
        );
      }
      throw invalidCredentials();
    }
    try {
      await this.db.platformTransaction(SIGN_IN_JOB, async (trx) => {
        await this.audit.append(trx, {
          action: 'auth.operator-login-failed',
          entityType: 'operator',
          entityId: operatorId,
          details: { reason, ip },
        });
        if (lockSeconds !== undefined) {
          await this.audit.append(trx, {
            action: 'auth.operator-login-locked',
            entityType: 'operator',
            entityId: operatorId,
            details: { ip, lockSeconds },
          });
        }
      });
    } catch (error) {
      // The answer must stay the same 401; logged by error name only, not swallowed silently.
      this.logger.error(
        `Could not write the auth.operator-login-failed/-locked audit (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
    throw invalidCredentials();
  }
}
