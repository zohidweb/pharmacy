import {
  discountRuleStatus,
  bestDiscount,
  discountAmount,
  nextDiscount,
  returnLineRefund,
  returnRefundTotal,
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

describe('returnLineRefund', () => {
  it('refunds the price less the discount share of the returned goods (R1)', () => {
    // 120,00 с at 5 %: the 30,00 с item carries a discount share of 1,50 с
    expect(
      returnLineRefund({
        soldQuantity: 1,
        unitPriceMinor: 3000,
        discountShareMinor: 150,
        returnedQuantity: 0,
        quantity: 1,
      }),
    ).toEqual({ amountMinor: 3000, discountMinor: 150, refundMinor: 2850 });
  });

  it('takes exactly the line share over partial returns', () => {
    const line = { soldQuantity: 3, unitPriceMinor: 1000, discountShareMinor: 100 };
    const parts = [0, 1, 2].map((returnedQuantity) =>
      returnLineRefund({ ...line, returnedQuantity, quantity: 1 }),
    );
    expect(parts.map((p) => p.discountMinor)).toEqual([34, 33, 33]);
    expect(parts.map((p) => p.refundMinor)).toEqual([966, 967, 967]);
    expect(parts.reduce((sum, p) => sum + p.discountMinor, 0)).toBe(100);
  });

  it('rounds the refund down, in favour of the pharmacy', () => {
    expect(
      returnLineRefund({
        soldQuantity: 3,
        unitPriceMinor: 1000,
        discountShareMinor: 100,
        returnedQuantity: 0,
        quantity: 2,
      }),
    ).toEqual({ amountMinor: 2000, discountMinor: 67, refundMinor: 1933 });
  });

  it('sums the lines of a return', () => {
    expect(
      returnRefundTotal([
        {
          soldQuantity: 1,
          unitPriceMinor: 3000,
          discountShareMinor: 150,
          returnedQuantity: 0,
          quantity: 1,
        },
        {
          soldQuantity: 3,
          unitPriceMinor: 1000,
          discountShareMinor: 100,
          returnedQuantity: 0,
          quantity: 2,
        },
      ]),
    ).toEqual({ amountMinor: 5000, discountMinor: 217, refundMinor: 4783 });
  });

  it('has no discount without a share', () => {
    expect(
      returnLineRefund({
        soldQuantity: 2,
        unitPriceMinor: 620,
        discountShareMinor: 0,
        returnedQuantity: 1,
        quantity: 1,
      }),
    ).toEqual({ amountMinor: 620, discountMinor: 0, refundMinor: 620 });
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
