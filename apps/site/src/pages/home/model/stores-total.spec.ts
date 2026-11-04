import { vatOf } from '@pharmacy/shared-domain';
import { CALCULATOR_STORES, storesTotal } from './stores-total';

describe('storesTotal', () => {
  it('multiplies the store price by the number of stores and adds VAT', () => {
    expect(storesTotal(40000, 3, 1400)).toEqual({
      totalDirams: 120000,
      withVatDirams: 120000 + vatOf(120000, 1400),
    });
  });

  it('keeps the dirams of a store price that is not a whole somoni', () => {
    const { totalDirams, withVatDirams } = storesTotal(41250, 1, 1400);
    expect(totalDirams).toBe(41250);
    expect(withVatDirams).toBe(41250 + vatOf(41250, 1400));
  });

  it('clamps the number of stores to the range of the slider', () => {
    expect(storesTotal(40000, 0, 1400).totalDirams).toBe(40000);
    expect(storesTotal(40000, -5, 1400).totalDirams).toBe(40000);
    expect(storesTotal(40000, 31, 1400).totalDirams).toBe(40000 * 30);
    expect(storesTotal(40000, 2.6, 1400).totalDirams).toBe(120000);
  });

  it('is a plain zero for a zero price (the section hides the calculator then)', () => {
    expect(storesTotal(0, 3, 1400)).toEqual({
      totalDirams: 0,
      withVatDirams: 0,
    });
  });

  it('starts at 3 stores in a range of 1 to 30', () => {
    expect(CALCULATOR_STORES).toEqual({ min: 1, max: 30, initial: 3 });
  });
});
