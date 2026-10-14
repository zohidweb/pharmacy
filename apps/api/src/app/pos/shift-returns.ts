import { Injectable } from '@nestjs/common';
import type { ReceiptPaymentMethod } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import type { ShiftEventRow } from './shifts.repository';

/** The customer returns made in a shift (spec 2026-10-13-customer-returns, E13). */
export interface ShiftReturnTotals {
  count: number;
  amountDirams: number;
  /** The money back by kind. */
  byKind: Map<ReceiptPaymentMethod, { count: number; amountDirams: number }>;
  /** Kind `return`, the number of the return, the refund with a minus. */
  events: ShiftEventRow[];
}

export type ShiftReturnsSource = (
  trx: TenantTransaction,
  tenantId: string,
  shiftId: string,
) => Promise<ShiftReturnTotals>;

const NONE: ShiftReturnTotals = {
  count: 0,
  amountDirams: 0,
  byKind: new Map(),
  events: [],
};

// The returns of a shift, filled by the returns module (spec 2026-10-13-customer-returns, E16): the
// shift counts them without the POS depending on the returns module — as the terminals module asks
// the open shift through the checks the POS registers. Nothing registered — no returns.
@Injectable()
export class ShiftReturns {
  private source: ShiftReturnsSource | null = null;

  register(source: ShiftReturnsSource): void {
    this.source = source;
  }

  totals(
    trx: TenantTransaction,
    tenantId: string,
    shiftId: string,
  ): Promise<ShiftReturnTotals> {
    return this.source
      ? this.source(trx, tenantId, shiftId)
      : Promise.resolve(NONE);
  }
}
