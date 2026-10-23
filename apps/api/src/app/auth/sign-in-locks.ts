import { Injectable, Logger } from '@nestjs/common';
import { getRequestContext } from '../../common/context/request-context';
import { afterCommitBestEffort } from '../../common/errors/after-commit';
import { type LoginKind, TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { AccountLimiter, accountLimiterKey } from './account-limiter';
import { EmployeeAuthRepository } from './employee-auth.repository';
import {
  type LoginAttempt,
  LoginLimiter,
  loginLimiterKey,
} from './login-limiter';

/** Which limiter key a lock is on (security review 2026-10-22, P2). */
export type LockScope =
  'identifier' | 'account' | 'reconfirm' | 'password-change' | 'activation';

/** A lock an attempt placed: the kind of the identifier, never its value. */
export interface PlacedLock {
  scope: LockScope;
  lockSeconds: number;
  kind?: LoginKind;
}

/** The lock the attempt placed, if it reached the maximum: [] or one lock. */
export function placedLock(
  attempt: LoginAttempt,
  scope: LockScope,
  kind?: LoginKind,
): PlacedLock[] {
  if (!attempt.allowed || attempt.lockSeconds === undefined) return [];
  return [{ scope, lockSeconds: attempt.lockSeconds, ...(kind && { kind }) }];
}

/** Attempts of the password confirmation of a session (ADR-0008, amendment 2026-10-06). */
export function reconfirmLimiterKey(
  tenantId: string,
  employeeId: string,
): string {
  return `reconfirm:${tenantId}:${employeeId}`;
}

/** Attempts of the current password when the employee changes the own password. */
export function passwordChangeLimiterKey(
  tenantId: string,
  employeeId: string,
): string {
  return `password-change:${tenantId}:${employeeId}`;
}

// Locks of an employee's password attempts (security review 2026-10-22, A2 and P2; ADR-0008,
// amendment 2026-10-23): the account budget shared by the sign-in, the password confirmation and the
// own password change, and lifting every lock when a manager sets a new password or the owner
// activates.
@Injectable()
export class SignInLocks {
  private readonly logger = new Logger(SignInLocks.name);

  constructor(
    private readonly limiter: LoginLimiter,
    private readonly accounts: AccountLimiter,
    private readonly db: TenantDatabase,
    private readonly repository: EmployeeAuthRepository,
    private readonly audit: AuditService,
  ) {}

  /** One attempt of the account budget, after the attempt's own key and before any hashing. */
  reserveAccount(tenantId: string, employeeId: string): Promise<LoginAttempt> {
    return this.accounts.tryAcquire(accountLimiterKey(tenantId, employeeId));
  }

  /**
   * An identifier that matches nobody spends a budget of its own, keyed by the identifier, so a 429
   * of the account budget does not tell a known identifier from an unknown one (final review I2).
   */
  reserveUnknown(identifierKey: string): Promise<LoginAttempt> {
    return this.accounts.tryAcquire(`account:unknown:${identifierKey}`);
  }

  /** The password was verified: the account budget starts again. */
  resetAccount(tenantId: string, employeeId: string): Promise<void> {
    return this.accounts.reset(accountLimiterKey(tenantId, employeeId));
  }

  /**
   * `auth.login-locked` for each lock the attempt placed and did not lift by a success (security
   * review 2026-10-22, P2): once per lock, the refusals while locked are not written. In the tenant
   * context, its own transaction. The caller's answer must not change, so a failure is logged by
   * the error name, never thrown.
   */
  async record(
    employeeId: string,
    locks: readonly PlacedLock[],
    ip?: string,
  ): Promise<void> {
    if (locks.length === 0) return;
    try {
      await this.db.tenantTransaction(async (trx) => {
        for (const lock of locks) {
          await this.audit.append(trx, {
            action: 'auth.login-locked',
            entityType: 'employee',
            entityId: employeeId,
            details: { ...lock, ...(ip !== undefined && { ip }) },
          });
        }
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.error(
        `Could not write the auth.login-locked audit (${name}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
  }

  /**
   * A new password from a manager or an activation: the account budget and the attempts of every
   * identifier of the employee (as normalizeIdentifier makes them), of the password confirmation and
   * of the own password change go, by the reset of a successful sign-in: a lifted first lock takes
   * its history along (the next lock is a first one again), a repeated one keeps it. In the tenant
   * context. Best effort: the password is already set, so a failure is logged, never thrown.
   */
  async unlock(tenantId: string, employeeId: string): Promise<void> {
    await afterCommitBestEffort(
      this.logger,
      'Lifting the sign-in locks',
      async () => {
        const identifiers = await this.db.tenantTransaction((trx) =>
          this.repository.identifiers(trx, tenantId, employeeId),
        );
        const keys = [
          reconfirmLimiterKey(tenantId, employeeId),
          passwordChangeLimiterKey(tenantId, employeeId),
        ];
        if (identifiers !== null) {
          keys.push(loginLimiterKey('login', identifiers.login.toLowerCase()));
          if (identifiers.phone !== null) {
            keys.push(loginLimiterKey('phone', identifiers.phone));
          }
          if (identifiers.email !== null) {
            keys.push(
              loginLimiterKey('email', identifiers.email.toLowerCase()),
            );
          }
        }
        for (const key of keys) await this.limiter.reset(key);
        await this.resetAccount(tenantId, employeeId);
      },
    );
  }
}
