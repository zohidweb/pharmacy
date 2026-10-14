import { daysInMonth, prorateExpense } from './expenses';

describe('prorateExpense (spec 2026-10-14-owner-cabinet, O5, E16)', () => {
  it('takes the days of the period within the month', () => {
    expect(prorateExpense(310_000, '2026-10', '2026-10-01', '2026-10-14')).toBe(
      140_000,
    );
  });

  it('rounds the share of each record half up', () => {
    expect(prorateExpense(100, '2026-10', '2026-10-01', '2026-10-14')).toBe(45);
    expect(prorateExpense(1, '2026-11', '2026-11-01', '2026-11-15')).toBe(1);
  });

  it('gives the whole amount for a period covering the month', () => {
    expect(
      prorateExpense(123_457, '2026-10', '2026-09-01', '2026-12-31'),
    ).toBe(123_457);
  });

  it('gives nothing without an overlap', () => {
    expect(prorateExpense(500, '2026-10', '2026-11-01', '2026-11-30')).toBe(0);
  });

  it('divides by the days of the month of the record', () => {
    expect(prorateExpense(3_000, '2026-09', '2026-09-20', '2026-10-10')).toBe(
      1_100,
    );
    expect(prorateExpense(3_100, '2026-10', '2026-09-20', '2026-10-10')).toBe(
      1_000,
    );
    expect(prorateExpense(2_900, '2028-02', '2028-02-01', '2028-02-10')).toBe(
      1_000,
    );
  });

  it('knows the days of a month', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-10')).toBe(31);
  });
});
