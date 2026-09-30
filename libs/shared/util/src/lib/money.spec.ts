import { CURRENCY_SIGN, formatMoney, parseMoneyToMinor } from './money.js';

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('formats dirams as somoni with grouping and the currency sign', () => {
    expect(plain(formatMoney(195730))).toBe(`1 957,30 ${CURRENCY_SIGN}`);
    expect(plain(formatMoney(12000))).toBe(`120,00 ${CURRENCY_SIGN}`);
  });

  it('keeps leading zeros in dirams and handles zero and negatives', () => {
    expect(plain(formatMoney(5))).toBe(`0,05 ${CURRENCY_SIGN}`);
    expect(plain(formatMoney(0))).toBe(`0,00 ${CURRENCY_SIGN}`);
    expect(plain(formatMoney(-41400))).toBe(`-414,00 ${CURRENCY_SIGN}`);
  });

  it('omits the sign for table cells', () => {
    expect(plain(formatMoney(333730, { withSign: false }))).toBe('3 337,30');
  });

  it('uses non-breaking spaces by default and plain spaces on request', () => {
    expect(formatMoney(195730)).not.toContain(' ');
    expect(formatMoney(195730, { plainSpaces: true })).toBe(
      `1 957,30 ${CURRENCY_SIGN}`,
    );
  });

  it('is exact for the largest safe amounts', () => {
    expect(
      plain(formatMoney(Number.MAX_SAFE_INTEGER, { withSign: false })),
    ).toBe('90 071 992 547 409,91');
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatMoney(10.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
  });
});

describe('parseMoneyToMinor', () => {
  it.each([
    ['120', 12000],
    ['120,5', 12050],
    ['120.50', 12050],
    ['1 200,00', 120000],
    ['1\u00a0200', 120000],
    [' 0,05 ', 5],
  ])('parses %j as %d dirams', (input, expected) => {
    expect(parseMoneyToMinor(input)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '-5',
    '1,234',
    '1.2.3',
    '12,',
    ',5',
    '1e3',
    '1234567890123',
  ])('returns null for %j', (input) => {
    expect(parseMoneyToMinor(input)).toBeNull();
  });
});
