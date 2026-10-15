import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';

/** Work a listener asks to do after the acceptance commits (e.g. ending the terminal sessions). */
export type AfterAcceptance = () => Promise<void>;

/**
 * Called in the transaction of the acceptance of a transfer; may return work for after the commit.
 * A throw rolls the acceptance back.
 */
export type TransferAcceptanceListener = (
  trx: TenantTransaction,
  tenantId: string,
  transferId: string,
) => Promise<AfterAcceptance | void>;

// The acceptance of a transfer told to the modules that care (spec 2026-10-15-store-closing, E11): the
// stores module closes a closing store when the last of its transfers is accepted. The module that
// knows the rule registers it, so the inventory module depends on nobody (as TerminalRevocationChecks).
@Injectable()
export class TransferAcceptance {
  private readonly listeners: TransferAcceptanceListener[] = [];

  register(listener: TransferAcceptanceListener): void {
    this.listeners.push(listener);
  }

  /** Runs every listener in the transaction of the acceptance; returns the work for after it. */
  async notify(
    trx: TenantTransaction,
    tenantId: string,
    transferId: string,
  ): Promise<AfterAcceptance[]> {
    const after: AfterAcceptance[] = [];
    for (const listener of this.listeners) {
      const work = await listener(trx, tenantId, transferId);
      if (work) after.push(work);
    }
    return after;
  }
}
