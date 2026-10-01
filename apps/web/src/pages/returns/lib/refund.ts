/*
 * Refund of a customer return (ТЗ «Возвраты»): the discount is recalculated for what the customer
 * keeps (shared-domain), money goes back the way it was paid — along the receipt payments in order.
 */
import { returnRefund, type ReturnRefund } from '@pharmacy/shared-domain';
import type { ReceiptPayment, ReturnableReceipt } from '@pharmacy/shared-dto';

export type ReturnQuantities = Record<string, number>;

export function returnedSubtotal(
  receipt: ReturnableReceipt,
  quantities: ReturnQuantities,
): number {
  return receipt.lines.reduce(
    (sum, line) => sum + (quantities[line.lineId] ?? 0) * line.unitPriceMinor,
    0,
  );
}

export function refundOf(
  receipt: ReturnableReceipt,
  quantities: ReturnQuantities,
): ReturnRefund {
  return returnRefund({
    subtotalMinor: receipt.subtotalMinor,
    discountMinor: receipt.discountMinor,
    previouslyReturnedSubtotalMinor: receipt.returnedSubtotalMinor,
    returnedSubtotalMinor:
      receipt.returnedSubtotalMinor + returnedSubtotal(receipt, quantities),
    percent: receipt.discountPercent,
    minSubtotalMinor: receipt.discountMinSubtotalMinor,
  });
}

/** Splits the refund over the payments of the receipt (same methods, never above what was paid). */
export function refundPayments(
  payments: readonly ReceiptPayment[],
  refundMinor: number,
): ReceiptPayment[] {
  let left = refundMinor;
  const out: ReceiptPayment[] = [];
  for (const payment of payments) {
    if (left <= 0) break;
    const amountMinor = Math.min(left, payment.amountMinor);
    out.push({ method: payment.method, amountMinor });
    left -= amountMinor;
  }
  return out;
}
