import { Injectable } from '@nestjs/common';
import { checkPin } from '@pharmacy/shared-domain';
import type { MyTerminal } from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { PasswordHasher } from '../../core/crypto';
import { TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { LoginLimiter } from '../auth/login-limiter';
import { TerminalsRepository } from './terminals.repository';
import { TerminalsService } from './terminals.service';

const invalidCurrentPin = () =>
  new FieldProblemException(422, 'invalid_current_pin', [
    { field: 'currentPin', code: 'invalid_current_pin' },
  ]);

// The own PIN and the own terminals of the signed-in employee (auth design 2026-10-02, section 8).
// The tenant and the employee come from the principal. PINs and hashes are never logged or audited.
@Injectable()
export class MePinService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: TerminalsRepository,
    private readonly terminals: TerminalsService,
    private readonly hasher: PasswordHasher,
    private readonly limiter: LoginLimiter,
    private readonly audit: AuditService,
  ) {}

  /**
   * Sets a new PIN and clears the failure counter and the lock. The current PIN is checked only
   * while a PIN is set and not locked; a locked or missing PIN needs only the fresh password
   * session the route requires (plan decision P4), so a cashier can lift his own lock.
   */
  async changePin(currentPin: string | null, newPin: string): Promise<void> {
    const { tenantId, employeeId } = requirePrincipal();

    const state = await this.db.tenantTransaction((trx) =>
      this.repository.pinState(trx, tenantId, employeeId),
    );
    if (
      state.pinHash !== null &&
      state.pinPepperVersion !== null &&
      state.pinLockedAt === null
    ) {
      // Reserved atomically before hashing, like a password change.
      const key = `pin-change:${tenantId}:${employeeId}`;
      const attempt = await this.limiter.tryAcquire(key);
      if (!attempt.allowed) throw new ProblemException(429, 'login_locked');
      if (
        currentPin === null ||
        !(await this.hasher.verify(currentPin, state.pinHash, state.pinPepperVersion))
      ) {
        throw invalidCurrentPin();
      }
      await this.limiter.reset(key);
    }

    const minLength = await this.db.tenantTransaction((trx) =>
      this.repository.pinMinLength(trx, tenantId),
    );
    const problem = checkPin(newPin, minLength);
    if (problem === 'trivial') {
      throw new FieldProblemException(422, 'pin_trivial', [
        { field: 'newPin', code: 'pin_trivial' },
      ]);
    }
    if (problem !== null) {
      throw new FieldProblemException(422, 'pin_length', [
        { field: 'newPin', code: 'pin_length' },
      ]);
    }

    // No transaction is held open during scrypt.
    const next = await this.hasher.hash(newPin);
    await this.db.tenantTransaction(async (trx) => {
      await this.repository.setPin(trx, tenantId, employeeId, next);
      await this.audit.append(trx, {
        action: 'auth.pin-changed',
        entityType: 'employee',
        entityId: employeeId,
      });
    });
  }

  /** Terminals the employee signed in on by PIN in the last 90 days. */
  async myTerminals(deviceSecret: string | null): Promise<MyTerminal[]> {
    const { tenantId, employeeId } = requirePrincipal();
    const currentId = await this.currentTerminalId(deviceSecret, tenantId);
    const rows = await this.db.tenantTransaction((trx) =>
      this.repository.myTerminals(trx, tenantId, employeeId),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      storeName: row.storeName,
      boundAt: row.boundAt.toISOString(),
      lastSeenAt: row.lastSignInAt.toISOString(),
      current: row.id === currentId,
    }));
  }

  private async currentTerminalId(
    secret: string | null,
    tenantId: string,
  ): Promise<string | null> {
    try {
      const device = await this.terminals.resolveDevice(secret);
      return device.tenantId === tenantId ? device.terminalId : null;
    } catch (error) {
      if (error instanceof ProblemException && error.code === 'not_bound') {
        return null;
      }
      throw error;
    }
  }
}
