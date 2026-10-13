import { Injectable } from '@nestjs/common';
import type {
  PaymentTotal,
  ReceiptPaymentMethod,
  Shift,
  ShiftEvent,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import { ShiftReturns } from './shift-returns';
import { type ShiftRow, ShiftsRepository } from './shifts.repository';

const METHODS: ReceiptPaymentMethod[] = ['cash', 'card', 'qr', 'nfc'];

// The `Shift` of the contract from the rows of a shift (spec 2026-10-13-pos-shift-sale, 4.4): the
// totals are counted from its receipts, payments and cash operations, never stored. The cash part
// of a receipt is the cash handed over minus the change (the payment row holds what was handed
// over, E10). The customer returns made in the shift come from the returns module through
// `ShiftReturns` (spec 2026-10-13-customer-returns, E13): their cash leaves the drawer, and the bank
// terminal of a kind is reconciled against the sales less the returns of that kind.
@Injectable()
export class ShiftMapper {
  constructor(
    private readonly shifts: ShiftsRepository,
    private readonly returns: ShiftReturns,
  ) {}

  async view(
    trx: TenantTransaction,
    tenantId: string,
    shift: ShiftRow,
  ): Promise<Shift> {
    const totals = await this.shifts.totals(trx, tenantId, shift.id);
    const rows = await this.shifts.events(trx, tenantId, shift.id);
    const returned = await this.returns.totals(trx, tenantId, shift.id);
    const byMethod = Object.fromEntries(
      METHODS.map((method): [ReceiptPaymentMethod, PaymentTotal] => {
        const kind = totals.byKind.get(method);
        const amount = kind?.amountDirams ?? 0;
        return [
          method,
          {
            count: kind?.count ?? 0,
            amountMinor:
              method === 'cash' ? amount - totals.changeDirams : amount,
          },
        ];
      }),
    ) as Record<ReceiptPaymentMethod, PaymentTotal>;
    const opening = Number(shift.openingCashDirams);
    const sales = byMethod.cash.amountMinor;
    const returnsByMethod = Object.fromEntries(
      METHODS.map((method): [ReceiptPaymentMethod, PaymentTotal] => {
        const kind = returned.byKind.get(method);
        return [
          method,
          { count: kind?.count ?? 0, amountMinor: kind?.amountDirams ?? 0 },
        ];
      }),
    ) as Record<ReceiptPaymentMethod, PaymentTotal>;
    const cashReturns = returnsByMethod.cash.amountMinor;
    const events: ShiftEvent[] = [...rows, ...returned.events].map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      kind: row.kind,
      reference: row.reference,
      employeeName: row.employeeName,
      amountMinor: row.amountDirams,
      flagged: row.flagged,
    }));
    events.push({
      id: `${shift.id}-opened`,
      at: shift.openedAt.toISOString(),
      kind: 'opened',
      reference: null,
      employeeName: shift.openedByName,
      amountMinor: opening,
      flagged: shift.openedAuthorFlagged,
    });
    if (shift.closedAt !== null) {
      events.push({
        id: `${shift.id}-closed`,
        at: shift.closedAt.toISOString(),
        kind: 'closed',
        reference: null,
        employeeName: shift.closedByName ?? '',
        amountMinor: Number(shift.countedCashDirams ?? 0n),
        flagged: shift.closedAuthorFlagged,
      });
    }
    // the newest first, as the log of the screen shows them
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return {
      id: shift.id,
      number: shift.number,
      storeId: shift.storeId,
      status: shift.status,
      openedAt: shift.openedAt.toISOString(),
      openedBy: shift.openedByName,
      closedAt: shift.closedAt?.toISOString() ?? null,
      receipts: totals.receipts,
      byMethod,
      returns: { count: returned.count, amountMinor: returned.amountDirams },
      returnsByMethod,
      // sales less returns
      revenueMinor: totals.revenueDirams - returned.amountDirams,
      cash: {
        openingMinor: opening,
        salesMinor: sales,
        inMinor: totals.depositsDirams,
        outMinor: totals.withdrawalsDirams,
        returnsMinor: cashReturns,
        expectedMinor:
          opening +
          sales +
          totals.depositsDirams -
          totals.withdrawalsDirams -
          cashReturns,
      },
      discrepancyReceipts: totals.discrepancyReceipts,
      events,
    };
  }
}
