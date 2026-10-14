/*
 * Discount rules of a receipt (glossary «Скидочное правило»): thresholds by the receipt subtotal,
 * the single most favourable rule applies. Amounts are integer dirams (ADR-0016); the discount is
 * rounded half up to a diram. The same functions price the receipt on the POS and on the server.
 */
export interface DiscountRule {
  id: string;
  /** Subtotal from which the rule applies, dirams. */
  minSubtotalMinor: number;
  /** Whole percent, 1–100. */
  percent: number;
}

export interface AppliedDiscount {
  ruleId: string | null;
  percent: number;
  amountMinor: number;
}

const NONE: AppliedDiscount = { ruleId: null, percent: 0, amountMinor: 0 };

export function discountAmount(subtotalMinor: number, percent: number): number {
  return Math.round((subtotalMinor * percent) / 100);
}

/** The most favourable rule whose threshold the subtotal reaches. */
export function bestDiscount(
  subtotalMinor: number,
  rules: readonly DiscountRule[],
): AppliedDiscount {
  let best = NONE;
  for (const rule of rules) {
    if (subtotalMinor < rule.minSubtotalMinor) continue;
    const amountMinor = discountAmount(subtotalMinor, rule.percent);
    if (amountMinor > best.amountMinor) {
      best = { ruleId: rule.id, percent: rule.percent, amountMinor };
    }
  }
  return best;
}

/** The next threshold above the subtotal — the hint «ещё N до скидки M %». */
export function nextDiscount(
  subtotalMinor: number,
  rules: readonly DiscountRule[],
): DiscountRule | null {
  const current = bestDiscount(subtotalMinor, rules).percent;
  return (
    [...rules]
      .filter((rule) => rule.minSubtotalMinor > subtotalMinor)
      .filter((rule) => rule.percent > current)
      .sort((a, b) => a.minSubtotalMinor - b.minSubtotalMinor)[0] ?? null
  );
}

export interface ReturnLineRefundInput {
  /** Sold on the receipt line, in its sale unit (packs or pieces). */
  soldQuantity: number;
  /** Price of the sale unit, dirams. */
  unitPriceMinor: number;
  /** Discount share of the whole receipt line (`receipt_lines.discount_share_dirams`). */
  discountShareMinor: number;
  /** Returned by earlier returns of the line, in its sale unit. */
  returnedQuantity: number;
  /** Returned now, in its sale unit. */
  quantity: number;
}

export interface ReturnLineRefund {
  /** The returned goods at their price. */
  amountMinor: number;
  /** The discount share taken back with them. */
  discountMinor: number;
  /** Money back to the customer. */
  refundMinor: number;
}

/**
 * Refund of a (partial) return of a receipt line (decision 2026-09-30; spec 2026-10-13-customer-
 * returns, R1, E6): the price of the returned goods less their share of the discount; the
 * discount on the goods the customer keeps stays. The share is taken cumulatively — after every
 * return the line has given back ⌈share × returned / sold⌉ — so a line returned in parts gives back
 * exactly its share, and the refund rounds down, in favour of the pharmacy.
 */
export function returnLineRefund(input: ReturnLineRefundInput): ReturnLineRefund {
  const taken = (returned: number) =>
    Math.ceil((input.discountShareMinor * returned) / input.soldQuantity);
  const amountMinor = input.quantity * input.unitPriceMinor;
  const discountMinor =
    taken(input.returnedQuantity + input.quantity) - taken(input.returnedQuantity);
  return { amountMinor, discountMinor, refundMinor: amountMinor - discountMinor };
}

/** The refund of a return: the sum of its lines. */
export function returnRefundTotal(
  lines: readonly ReturnLineRefundInput[],
): ReturnLineRefund {
  return lines.map(returnLineRefund).reduce(
    (sum, line) => ({
      amountMinor: sum.amountMinor + line.amountMinor,
      discountMinor: sum.discountMinor + line.discountMinor,
      refundMinor: sum.refundMinor + line.refundMinor,
    }),
    { amountMinor: 0, discountMinor: 0, refundMinor: 0 },
  );
}

export type DiscountRuleStatus = 'active' | 'scheduled' | 'expired';

/** Status of a rule by its validity period (dates YYYY-MM-DD, inclusive; null — indefinite). */
export function discountRuleStatus(
  period: { from: string; to: string | null } | null,
  today: string,
): DiscountRuleStatus {
  if (!period) return 'active';
  if (today < period.from) return 'scheduled';
  if (period.to !== null && today > period.to) return 'expired';
  return 'active';
}
