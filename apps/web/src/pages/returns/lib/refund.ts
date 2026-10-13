/*
 * Refund of a customer return (spec 2026-10-13-customer-returns, R1, E6, E7): the price of the
 * returned goods less their share of the discount (the same `returnLineRefund` the server checks),
 * the money back along the ways the receipt was paid — cash, card, QR, NFC — never above what is
 * left to refund of a way.
 */
import {
  returnRefundTotal,
  type ReturnLineRefund,
} from '@pharmacy/shared-domain';
import type {
  ReceiptPayment,
  ReceiptPaymentMethod,
  ReturnableReceipt,
} from '@pharmacy/shared-dto';

export type ReturnQuantities = Record<string, number>;

export function refundOf(
  receipt: ReturnableReceipt,
  quantities: ReturnQuantities,
): ReturnLineRefund {
  return returnRefundTotal(
    receipt.lines
      .filter((line) => (quantities[line.lineId] ?? 0) > 0)
      .map((line) => ({
        soldQuantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        discountShareMinor: line.discountShareMinor,
        returnedQuantity: line.returnedQuantity,
        quantity: quantities[line.lineId] ?? 0,
      })),
  );
}

const ORDER: readonly ReceiptPaymentMethod[] = ['cash', 'card', 'qr', 'nfc'];

/** Splits the refund over what is left to refund by way of payment, in the order of E7. */
export function refundPayments(
  refundable: readonly ReceiptPayment[],
  refundMinor: number,
): ReceiptPayment[] {
  let left = refundMinor;
  const out: ReceiptPayment[] = [];
  for (const method of ORDER) {
    const payment = refundable.find((p) => p.method === method);
    if (!payment || left <= 0) continue;
    const amountMinor = Math.min(left, payment.amountMinor);
    if (amountMinor > 0) out.push({ method, amountMinor });
    left -= amountMinor;
  }
  return out;
}
