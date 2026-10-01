/**
 * Money: integer dirams in every layer (1 somoni = 100 dirams); TJS is the only currency
 * (ADR-0016). Conversion to somoni happens only here, for display and input parsing.
 */

/** Currency sign used in the UI mockups ("1 957,30 с"); final sign to be confirmed with the customer. */
export const CURRENCY_SIGN = 'с';

const MAX_SOMONI_DIGITS = 12;
const NBSP = String.fromCharCode(0xa0);
// U+00A0 (no-break space) and U+202F (narrow no-break space, ru-RU group separator)
const WIDE_SPACES = new RegExp('[\\u00a0\\u202f]', 'g');
const groupFormat = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

export interface FormatMoneyOptions {
  /** Append the currency sign (default true). Tables put the sign in the column header instead. */
  withSign?: boolean;
  /** Plain spaces instead of U+00A0/U+202F — for receipt printers lacking those glyphs. */
  plainSpaces?: boolean;
}

/** `formatMoney(195730)` → `1 957,30 с` (ru-RU grouping for both RU and TJ). */
export function formatMoney(
  amountMinor: number,
  options: FormatMoneyOptions = {},
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Money must be a safe integer amount in dirams');
  }
  const { withSign = true, plainSpaces = false } = options;
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  const dirams = abs % 100;
  const somoni = (abs - dirams) / 100; // exact integer division, no float rounding
  const number = `${sign}${groupFormat.format(somoni)},${String(dirams).padStart(2, '0')}`;
  const text = withSign ? `${number}${NBSP}${CURRENCY_SIGN}` : number;
  return plainSpaces ? text.replace(WIDE_SPACES, ' ') : text;
}

/**
 * Parses user input in somoni ("1 200", "1200,5", "1200.50") into dirams.
 * Returns null for anything that is not a non-negative amount with at most 2 fraction digits.
 */
export function parseMoneyToMinor(input: string): number | null {
  const normalized = input.replace(/\s/g, '').replace(WIDE_SPACES, '');
  const match = new RegExp(
    `^(\\d{1,${MAX_SOMONI_DIGITS}})(?:[.,](\\d{1,2}))?$`,
  ).exec(normalized);
  if (!match) {
    return null;
  }
  const somoni = Number(match[1]);
  const dirams = Number((match[2] ?? '').padEnd(2, '0'));
  return somoni * 100 + dirams;
}
