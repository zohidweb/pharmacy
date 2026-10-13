import { discountAmount } from '@pharmacy/shared-domain';
import type { CreateReceiptRequest } from '@pharmacy/shared-dto';
import type { FieldError } from '../../common/errors/validation-failed.exception';

/**
 * Shares of the discount of a receipt by line (data model 04, `discount_share_dirams`; E9):
 * proportional to the line amounts, rounded down, the remainder to the largest line (the first of
 * equal ones) — the shares always add up to the discount.
 */
export function discountShares(
  lineAmounts: readonly number[],
  discount: number,
): number[] {
  const total = lineAmounts.reduce((sum, a) => sum + a, 0);
  if (discount <= 0 || total <= 0) return lineAmounts.map(() => 0);
  const shares = lineAmounts.map((a) => Math.floor((a * discount) / total));
  const rest = discount - shares.reduce((sum, s) => sum + s, 0);
  let largest = 0;
  lineAmounts.forEach((a, i) => {
    if (a > lineAmounts[largest]) largest = i;
  });
  shares[largest] += rest;
  return shares;
}

/** The cash part of the payments: the cash line of the request is net of the change. */
export function cashPart(body: Pick<CreateReceiptRequest, 'payments'>): number {
  return body.payments.find((p) => p.method === 'cash')?.amountMinor ?? 0;
}

/**
 * The arithmetic of a receipt by the values of its own snapshot (spec 2026-10-13-pos-shift-sale, 4.5,
 * E23): what cannot be a fact even after the sale. Empty — the receipt adds up.
 */
export function checkArithmetic(body: CreateReceiptRequest): FieldError[] {
  const errors: FieldError[] = [];
  body.lines.forEach((line, i) => {
    if (line.amountMinor !== line.quantity * line.unitPriceMinor) {
      errors.push({ field: `lines.${i}.amountMinor`, code: 'mismatch' });
    }
  });
  const subtotal = body.lines.reduce((sum, l) => sum + l.amountMinor, 0);
  if (body.subtotalMinor !== subtotal) {
    errors.push({ field: 'subtotalMinor', code: 'mismatch' });
  }
  const discount =
    body.discountRuleId === null
      ? 0
      : body.subtotalMinor >= body.discountMinSubtotalMinor
        ? discountAmount(body.subtotalMinor, body.discountPercent)
        : -1;
  if (body.discountMinor !== discount) {
    errors.push({ field: 'discountMinor', code: 'mismatch' });
  }
  if (body.totalMinor !== body.subtotalMinor - body.discountMinor) {
    errors.push({ field: 'totalMinor', code: 'mismatch' });
  }
  const methods = body.payments.map((p) => p.method);
  if (new Set(methods).size !== methods.length) {
    errors.push({ field: 'payments', code: 'duplicate' });
  }
  const paid = body.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  if (paid !== body.totalMinor) {
    errors.push({ field: 'payments', code: 'total_mismatch' });
  }
  const cash = cashPart(body);
  if (body.cashTenderedMinor < cash) {
    errors.push({ field: 'cashTenderedMinor', code: 'too_small' });
  }
  // change only from the cash part
  const change = cash > 0 ? body.cashTenderedMinor - cash : 0;
  if (body.changeMinor !== change || (cash === 0 && body.cashTenderedMinor !== 0)) {
    errors.push({ field: 'changeMinor', code: 'mismatch' });
  }
  return errors;
}
