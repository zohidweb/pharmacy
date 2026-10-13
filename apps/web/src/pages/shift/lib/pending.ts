/* The shift with the operations still waiting in the buffer of the terminal (ADR-0015). */
import type { Shift } from '@pharmacy/shared-dto';
import type { PosOutboxRecord } from '@/shared/lib/offline-queue';

/**
 * The shift as it will be once its sales and cash operations still in the buffer reach the server:
 * the closing dialog compares the counted cash with it. Otherwise the cashier sees no discrepancy
 * that the server then finds and marks «reason not given» (spec 2026-10-13-pos-shift-sale, E24).
 * Quarantined operations are left out: the server has refused them; so are the ones the shift of the
 * server already shows (its events carry the ids of the operations).
 */
export function withPending(
  shift: Shift,
  records: readonly PosOutboxRecord[],
): Shift {
  const byMethod = Object.fromEntries(
    Object.entries(shift.byMethod).map(([m, total]) => [m, { ...total }]),
  ) as Shift['byMethod'];
  const cash = { ...shift.cash };
  let receipts = shift.receipts;
  let revenue = shift.revenueMinor;
  const known = new Set(shift.events.map((event) => event.id));
  for (const record of records) {
    if (record.status !== 'pending' || known.has(record.id)) continue;
    if (record.kind === 'receipt' && record.payload.shiftId === shift.id) {
      receipts += 1;
      revenue += record.payload.totalMinor;
      for (const payment of record.payload.payments) {
        byMethod[payment.method].count += 1;
        byMethod[payment.method].amountMinor += payment.amountMinor;
        // the cash line of a receipt is net of the change
        if (payment.method === 'cash') cash.salesMinor += payment.amountMinor;
      }
    }
    if (record.kind === 'shift.cash' && record.payload.shiftId === shift.id) {
      if (record.payload.kind === 'in')
        cash.inMinor += record.payload.amountMinor;
      else cash.outMinor += record.payload.amountMinor;
    }
  }
  cash.expectedMinor =
    cash.openingMinor +
    cash.salesMinor +
    cash.inMinor -
    cash.outMinor -
    cash.returnsMinor;
  return { ...shift, byMethod, cash, receipts, revenueMinor: revenue };
}
