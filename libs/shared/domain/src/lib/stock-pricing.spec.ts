import {
  markupOf,
  pieceCost,
  priceDeviation,
  stockState,
  suggestRetail,
} from './stock-pricing';

describe('stock pricing', () => {
  it('rounds the cost of a piece up, in favour of the pharmacy', () => {
    expect(pieceCost(310, 10)).toBe(31);
    expect(pieceCost(1_900, 16)).toBe(119); // 118.75
    expect(pieceCost(1, 3)).toBe(1);
    expect(() => pieceCost(100, 0)).toThrow(RangeError);
  });

  it('proposes the retail price by the markup, rounded up', () => {
    expect(suggestRetail(1_916, 45)).toBe(2_779); // 2778.2
    expect(suggestRetail(1_000, 0)).toBe(1_000);
  });

  it('computes the markup and the deviation from the order', () => {
    expect(markupOf(4_710, 7_000)).toBe(49);
    expect(markupOf(0, 100)).toBeNull();
    expect(priceDeviation(4_362, 4_714)).toBe(8);
    expect(priceDeviation(null, 100)).toBeNull();
  });
});

describe('stockState', () => {
  const state = (
    quantityPieces: number,
    minPieces = 100,
    daysToExpiry: number | null = 300,
  ) => stockState({ quantityPieces, minPieces, daysToExpiry });

  it('orders the states by urgency', () => {
    expect(state(-20)).toBe('negative');
    expect(state(0)).toBe('out');
    expect(state(50, 100, 12)).toBe('expiring');
    expect(state(50)).toBe('low');
    expect(state(500)).toBe('ok');
    expect(state(500, 100, null)).toBe('ok');
  });
});
