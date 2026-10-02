import {
  discountRuleStatus,
  bestDiscount,
  discountAmount,
  nextDiscount,
  returnRefund,
  type DiscountRule,
} from './discount';

const rules: DiscountRule[] = [
  { id: 'r3', minSubtotalMinor: 50_000, percent: 3 },
  { id: 'r5', minSubtotalMinor: 100_000, percent: 5 },
];

describe('bestDiscount', () => {
  it('applies the most favourable reached threshold', () => {
    expect(bestDiscount(49_999, rules)).toEqual({
      ruleId: null,
      percent: 0,
      amountMinor: 0,
    });
    expect(bestDiscount(50_000, rules)).toEqual({
      ruleId: 'r3',
      percent: 3,
      amountMinor: 1_500,
    });
    expect(bestDiscount(120_000, rules).ruleId).toBe('r5');
  });

  it('rounds half up to a diram', () => {
    expect(discountAmount(15_310, 3)).toBe(459); // 459.3
    expect(discountAmount(150, 3)).toBe(5); // 4.5
  });

  it('suggests the next threshold', () => {
    expect(nextDiscount(2_920, rules)?.id).toBe('r3');
    expect(nextDiscount(60_000, rules)?.id).toBe('r5');
    expect(nextDiscount(120_000, rules)).toBeNull();
  });
});

describe('returnRefund', () => {
  it('returns the proportional discount while the kept goods stay above the threshold', () => {
    // 700,00 с at 3 %: return 100,00 с, keep 600,00 с (still ≥ 500,00 с)
    const refund = returnRefund({
      subtotalMinor: 70_000,
      discountMinor: 2_100,
      returnedSubtotalMinor: 10_000,
      percent: 3,
      minSubtotalMinor: 50_000,
    });
    expect(refund).toEqual({
      returnedMinor: 10_000,
      discountRecalcMinor: 300,
      refundMinor: 9_700,
      keptDiscountMinor: 1_800,
    });
  });

  it('takes the whole discount back when the kept goods fall below the threshold', () => {
    // keep 400,00 с < 500,00 с: the kept goods lose their 12,00 с discount
    const refund = returnRefund({
      subtotalMinor: 70_000,
      discountMinor: 2_100,
      returnedSubtotalMinor: 30_000,
      percent: 3,
      minSubtotalMinor: 50_000,
    });
    expect(refund.refundMinor).toBe(70_000 - 2_100 - 40_000);
    expect(refund.keptDiscountMinor).toBe(0);
    expect(refund.discountRecalcMinor).toBe(2_100);
  });

  it('accounts for earlier returns of the same receipt', () => {
    const first = returnRefund({
      subtotalMinor: 70_000,
      discountMinor: 2_100,
      returnedSubtotalMinor: 10_000,
      percent: 3,
      minSubtotalMinor: 50_000,
    });
    const second = returnRefund({
      subtotalMinor: 70_000,
      discountMinor: 2_100,
      returnedSubtotalMinor: 30_000,
      previouslyReturnedSubtotalMinor: 10_000,
      percent: 3,
      minSubtotalMinor: 50_000,
    });
    // together the customer gets back exactly paid − price of what they keep
    expect(first.refundMinor + second.refundMinor).toBe(
      70_000 - 2_100 - 40_000,
    );
  });

  it('refunds the full price of a receipt without discount', () => {
    expect(
      returnRefund({
        subtotalMinor: 2_920,
        discountMinor: 0,
        returnedSubtotalMinor: 620,
        percent: 0,
        minSubtotalMinor: 0,
      }).refundMinor,
    ).toBe(620);
  });
});

describe('discountRuleStatus', () => {
  it('follows the validity period, inclusive', () => {
    const period = { from: '2026-10-01', to: '2026-10-31' };
    expect(discountRuleStatus(null, '2026-09-21')).toBe('active');
    expect(discountRuleStatus(period, '2026-09-30')).toBe('scheduled');
    expect(discountRuleStatus(period, '2026-10-01')).toBe('active');
    expect(discountRuleStatus(period, '2026-10-31')).toBe('active');
    expect(discountRuleStatus(period, '2026-11-01')).toBe('expired');
    expect(
      discountRuleStatus({ from: '2026-01-01', to: null }, '2030-01-01'),
    ).toBe('active');
  });
});
