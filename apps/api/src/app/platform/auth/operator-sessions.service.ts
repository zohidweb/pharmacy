import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OperatorSession } from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requireOperator,
} from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { PasswordHasher, SessionTokenService, sha256Hex } from '../../../core/crypto';
import { PlatformDatabase } from '../../../core/database/platform';
import { OperatorSessionStore } from '../../../core/sessions';
import { normalizeIdentifier } from '../../auth/identifier';
import { LoginClock, padFailure } from '../../auth/login-clock';
import { LoginLimiter } from '../../auth/login-limiter';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { OperatorAuthRepository } from './operator-auth.repository';

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
  | 'operator_blocked';

const SIGN_IN_JOB = { kind: 'system', job: 'operator-auth' } as const;

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

  async login(raw: string, password: string, ip: string): Promise<OperatorLoginResult> {
    const started = this.clock.now();
    try {
      return await this.attemptLogin(raw, password, ip);
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
    return {
      operator: {
        id: profile.id,
        fullName: profile.fullName,
        login: profile.login,
        role: operator.role,
      },
      authenticatedAt: operator.authenticatedAt,
    };
  }

  async logout(): Promise<void> {
    await this.sessions.destroy(requireOperator().sessionId);
  }

  private async attemptLogin(
    raw: string,
    password: string,
    ip: string,
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
    if (!attempt.allowed) throw new ProblemException(429, 'login_locked');

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
    if (found === null) return this.fail(null, 'unknown_login', ip);
    if (found.passwordHash === null) return this.fail(found.id, 'no_password', ip);
    if (!ok) return this.fail(found.id, 'invalid_password', ip);
    if (found.status !== 'active') return this.fail(found.id, 'operator_blocked', ip);

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

    const profile = await this.db.platformTransaction(
      { kind: 'operator', operatorId },
      async (trx) => {
        if (rehash !== null) {
          await this.repository.updatePasswordHash(trx, operatorId, verifiedPhc, rehash);
        }
        await this.repository.recordLogin(trx, operatorId);
        await this.audit.append(trx, {
          action: 'auth.operator-login-succeeded',
          entityType: 'operator',
          entityId: operatorId,
          details: { ip },
        });
        const row = await this.repository.findProfile(trx, operatorId);
        if (row === null) throw new ProblemException(401, 'unauthenticated');
        // Last inside the transaction: if the session cannot be stored, the audit rolls back.
        await this.sessions.create({
          sessionId,
          operatorId,
          authenticatedAt,
          idleTtlSeconds: this.idleTtlSeconds,
          absoluteExpiresAt: new Date(now + this.absoluteTtlSeconds * 1000).toISOString(),
        });
        return row;
      },
    );

    await this.limiter.reset(key);
    return {
      token,
      maxAgeSeconds: this.absoluteTtlSeconds,
      session: {
        operator: {
          id: profile.id,
          fullName: profile.fullName,
          login: profile.login,
          role: 'full_access',
        },
        authenticatedAt,
      },
    };
  }

  // A failed sign-in (already counted by tryAcquire): audited on the platform, answered as 401.
  private async fail(
    operatorId: string | null,
    reason: FailureReason,
    ip: string,
  ): Promise<never> {
    // An unknown login goes to the application log only, without the value: platform_audit_log is
    // append-only, and rotating unknown e-mails would otherwise fill it without bound. Failures of
    // a known operator are bounded by the per-login limiter.
    if (operatorId === null) {
      this.logger.warn(
        `Operator sign-in failed: unknown login [correlationId=${getRequestContext()?.correlationId}]`,
      );
      throw invalidCredentials();
    }
    try {
      await this.db.platformTransaction(SIGN_IN_JOB, (trx) =>
        this.audit.append(trx, {
          action: 'auth.operator-login-failed',
          entityType: 'operator',
          entityId: operatorId,
          details: { reason, ip },
        }),
      );
    } catch (error) {
      // The answer must stay the same 401; logged by error name only, not swallowed silently.
      this.logger.error(
        `Could not write the auth.operator-login-failed audit (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
    throw invalidCredentials();
  }
}
