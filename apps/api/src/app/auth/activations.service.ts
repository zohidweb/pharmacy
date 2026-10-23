import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passwordProblems } from '@pharmacy/shared-domain';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { afterCommitBestEffort } from '../../common/errors/after-commit';
import {
  LockedException,
  ProblemException,
} from '../../common/errors/problem.exception';
import { PasswordHasher } from '../../core/crypto';
import {
  ContextResolvers,
  type ResolvedLogin,
  TenantDatabase,
} from '../../core/database';
import { SessionStore } from '../../core/sessions';
import { AuditService } from '../audit/audit.service';
import {
  activationLimiterKey,
  hashActivationCode,
  normalizeActivationCode,
} from './activation-code';
import { EmployeeAuthRepository } from './employee-auth.repository';
import { normalizeIdentifier } from './identifier';
import { LoginClock, padFailure } from './login-clock';
import { LoginLimiter } from './login-limiter';
import { type PlacedLock, placedLock, SignInLocks } from './sign-in-locks';

// One answer for every failed code: unknown login, no code, expired, used or wrong code are
// indistinguishable.
const invalidCode = () => new ProblemException(401, 'invalid_code');

// Activation of an owner (or a reset) by the one-time code the platform operator hands over (auth
// design 2026-10-02, section 6). Passwords, codes, hashes and identifier values are never logged
// or audited.
@Injectable()
export class ActivationsService {
  private readonly logger = new Logger(ActivationsService.name);
  private readonly failureFloorMs: number;

  constructor(
    private readonly resolvers: ContextResolvers,
    private readonly db: TenantDatabase,
    private readonly repository: EmployeeAuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionStore,
    private readonly limiter: LoginLimiter,
    private readonly locks: SignInLocks,
    private readonly audit: AuditService,
    private readonly clock: LoginClock,
    config: ConfigService,
  ) {
    this.failureFloorMs = config.getOrThrow<number>('LOGIN_FAILURE_FLOOR_MS');
  }

  async activate(
    rawLogin: string,
    rawCode: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    // The policy is checked before any lookup: a 422 reveals nothing about the account and does
    // not spend the code.
    if (passwordProblems(newPassword).length > 0) {
      throw new ProblemException(422, 'password_policy');
    }

    const started = this.clock.now();
    try {
      await this.attemptActivation(rawLogin, rawCode, newPassword, ip);
    } catch (error) {
      // Every 401 invalid_code takes at least the floor (plus jitter) from the start, like a
      // failed sign-in. Successes, 422 and 429 are not padded.
      if (error instanceof ProblemException && error.code === 'invalid_code') {
        await padFailure(this.clock, this.failureFloorMs, started);
      }
      throw error;
    }
  }

  private async attemptActivation(
    rawLogin: string,
    rawCode: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    // Nothing can match input that does not normalize, so no limiter key is spent on it (the IP
    // throttler still applies).
    const identifier = normalizeIdentifier(rawLogin);
    const code = normalizeActivationCode(rawCode);
    if (identifier === null || code === null) throw invalidCode();

    // The attempt is reserved atomically before any hashing or database work.
    const key = activationLimiterKey(identifier.kind, identifier.value);
    const attempt = await this.limiter.tryAcquire(key);
    if (!attempt.allowed) throw new LockedException(429, 'login_locked', attempt.retryAfterSeconds);

    const resolved = await this.resolvers.resolveLogin(
      identifier.kind,
      identifier.value,
    );
    // The lock this attempt placed, written if the code is wrong (security review P2).
    const locks = placedLock(attempt, 'activation', identifier.kind);
    if (resolved === null || resolved.tenantStatus !== 'active') {
      // The same scrypt cost as a known login, so the timing does not tell them apart.
      await this.hasher.verifyDummy(newPassword);
      if (locks.length > 0) {
        // No tenant journal to write to: the application log, without the identifier.
        this.logger.warn(
          `Activation locked: unknown ${identifier.kind} [correlationId=${getRequestContext()?.correlationId}]`,
        );
      }
      throw invalidCode();
    }

    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    await runWithContext(
      { correlationId, tenantId: resolved.tenantId, principal: null },
      () => this.activateInTenant(resolved, code, newPassword, key, locks, ip),
    );
  }

  private async activateInTenant(
    resolved: ResolvedLogin,
    code: string,
    newPassword: string,
    key: string,
    locks: readonly PlacedLock[],
    ip: string,
  ): Promise<void> {
    const { tenantId, employeeId } = resolved;
    // No transaction is held open during scrypt.
    const next = await this.hasher.hash(newPassword);
    const codeHash = hashActivationCode(code);

    // Check, consume, set the password and audit commit together or not at all. A wrong code ends
    // the attempt: a lock it placed goes to the journal.
    const consumed = await this.db.tenantTransaction(async (trx) => {
      if (
        !(await this.repository.consumeActivationCode(
          trx,
          tenantId,
          employeeId,
          codeHash,
          next,
        ))
      ) {
        return false;
      }
      await this.audit.append(trx, {
        action: 'auth.activated',
        entityType: 'employee',
        entityId: employeeId,
      });
      return true;
    });
    if (!consumed) {
      await this.locks.record(employeeId, locks, ip);
      throw invalidCode();
    }

    // After the commit: sessions opened with the old password end, the attempts are forgotten. The
    // password is set and the code is spent, so a retry would only meet 401 invalid_code: a failure
    // here is logged, not answered.
    await afterCommitBestEffort(this.logger, 'Ending the sessions of an activated employee', () =>
      this.sessions.destroyAllFor(tenantId, employeeId),
    );
    await afterCommitBestEffort(this.logger, 'Resetting the activation attempts', () =>
      this.limiter.reset(key),
    );
    // The new password lifts the sign-in locks of the owner (security review A2): best effort.
    await this.locks.unlock(tenantId, employeeId);
  }
}
