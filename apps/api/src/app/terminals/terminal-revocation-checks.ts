import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';

/** Throws (a ProblemException) when the terminal may not be revoked now. */
export type TerminalRevocationCheck = (
  trx: TenantTransaction,
  tenantId: string,
  terminalId: string,
) => Promise<void>;

// Checks other modules hang on the revocation of a terminal (unbinding, or binding the same
// browser again): the POS forbids it while the terminal has an open shift (spec
// 2026-10-13-pos-shift-sale, E14). The module that knows the rule registers it, so the terminals
// module depends on nobody; on an offline store, where the POS is not registered, nothing checks.
@Injectable()
export class TerminalRevocationChecks {
  private readonly checks: TerminalRevocationCheck[] = [];

  register(check: TerminalRevocationCheck): void {
    this.checks.push(check);
  }

  /** Runs every check in the transaction of the revocation. */
  async run(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<void> {
    for (const check of this.checks) await check(trx, tenantId, terminalId);
  }
}
