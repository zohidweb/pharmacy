import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { ShiftsRepository } from './shifts.repository';

// The open shift of a terminal for the customer returns (spec 2026-10-13-customer-returns, E3): a
// return goes into the open shift of the terminal of the session, whatever shift sold the receipt.
@Injectable()
export class PosShifts {
  constructor(private readonly shifts: ShiftsRepository) {}

  /** The open shifts of a store: one forbids its closing (spec 2026-10-15-store-closing, Z2). */
  openShiftsOfStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<number> {
    return this.shifts.openShiftsOfStore(trx, tenantId, storeId);
  }

  /**
   * The open shift of the terminal locked `FOR SHARE`: a closing (`FOR UPDATE`) either waits for the
   * return or has closed the shift before it is seen. Null — no open shift.
   */
  async lockOpenShiftOfTerminal(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<{ id: string; storeId: string } | null> {
    const open = await this.shifts.openShiftOfTerminal(trx, tenantId, terminalId);
    if (!open) return null;
    const locked = await this.shifts.lockShift(trx, tenantId, open.id, 'share');
    return locked && locked.status === 'open'
      ? { id: locked.id, storeId: locked.storeId }
      : null;
  }
}
