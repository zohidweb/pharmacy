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

export interface ReturnRefundInput {
  /** Subtotal of the receipt before discount, dirams. */
  subtotalMinor: number;
  /** Discount actually given on the receipt. */
  discountMinor: number;
  /** Subtotal of everything returned so far and now (lines at their prices). */
  returnedSubtotalMinor: number;
  /** Subtotal already returned by earlier returns of this receipt. */
  previouslyReturnedSubtotalMinor?: number;
  /** Percent the receipt was sold with: the rule is re-applied to what the customer keeps. */
  percent: number;
  /** Threshold of that rule: below it the kept goods lose the discount. */
  minSubtotalMinor: number;
}

export interface ReturnRefund {
  /** Subtotal of the lines returned now. */
  returnedMinor: number;
  /** Part of the discount that goes back with the returned goods or is lost below the threshold. */
  discountRecalcMinor: number;
  /** Money back to the customer. */
  refundMinor: number;
  /** Discount kept on the goods the customer keeps. */
  keptDiscountMinor: number;
}

/**
 * Refund of a (partial) customer return with the discount recalculated (ТЗ «Возвраты»): the customer
 * pays for what they keep as if they had bought only that — if the kept subtotal falls below the
 * threshold, the discount on it is lost. Refund = paid before − price of the kept goods.
 */
export function returnRefund(input: ReturnRefundInput): ReturnRefund {
  const before = input.previouslyReturnedSubtotalMinor ?? 0;
  const keptBefore = input.subtotalMinor - before;
  const keptAfter = input.subtotalMinor - input.returnedSubtotalMinor;
  const discountOf = (kept: number) =>
    kept >= input.minSubtotalMinor ? discountAmount(kept, input.percent) : 0;
  const discountBefore =
    before === 0 ? input.discountMinor : discountOf(keptBefore);
  const keptDiscountMinor = discountOf(keptAfter);
  const paidBefore = keptBefore - discountBefore;
  const paidAfter = keptAfter - keptDiscountMinor;
  const returnedMinor = keptBefore - keptAfter;
  const refundMinor = paidBefore - paidAfter;
  return {
    returnedMinor,
    discountRecalcMinor: returnedMinor - refundMinor,
    refundMinor,
    keptDiscountMinor,
  };
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
