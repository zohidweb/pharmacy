import {
  countries,
  isCountryCode,
  type ProductUnit,
} from '@pharmacy/shared-domain';
import type { ImportIssueCode, PrescriptionKind } from '@pharmacy/shared-dto';
import { matchKey, parseMoneyToMinor } from '@pharmacy/shared-util';
import { type Cell, excelSerialToDate } from '@/shared/lib/spreadsheet';

/** A value read from a cell, or why it cannot be (spec 2026-10-20-data-import, section 4). */
export type Parsed<T> =
  { ok: true; value: T } | { ok: false; code: ImportIssueCode };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(code: ImportIssueCode): Parsed<T> => ({ ok: false, code });

const words = (cell: Cell): string => (cell ? matchKey(cell.text) : '');

/** A text of one line: the line breaks of a cell become spaces. */
export function parseText(cell: Cell, max: number): Parsed<string> {
  const text = cell ? cell.text.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? fail('max') : ok(text);
}

/**
 * The barcodes of a cell: several codes separated by `,` `;` `/` or a line break, spaces inside a code removed, 8–14
 * digits each. `4,6E+12` is what Excel writes for a 13-digit number in the «General» format: the digits are lost.
 */
export function parseBarcodes(cell: Cell): Parsed<string[]> {
  if (cell === null) return ok([]);
  if (/\d[eE][+-]?\d/.test(cell.text)) return fail('barcode_scientific');
  const codes = cell.text
    .split(/[,;/\n]+/)
    .map((code) => code.replace(/\s+/g, ''))
    .filter((code) => code !== '');
  if (codes.some((code) => !/^[0-9]{8,14}$/.test(code))) return fail('invalid');
  if (codes.length > 20) return fail('max');
  return ok(codes);
}

/** A whole number; `fallback` for an empty cell (null — the cell is required). */
export function parseInteger(
  cell: Cell,
  min: number,
  max: number,
  fallback: number | null,
): Parsed<number> {
  if (cell === null) return fallback === null ? fail('required') : ok(fallback);
  let value: number;
  if (cell.number !== null) {
    value = cell.number;
  } else {
    const text = cell.text.replace(/\s+/g, '');
    if (!/^-?\d+$/.test(text)) return fail('invalid');
    value = Number(text);
  }
  if (!Number.isInteger(value) || value < min) return fail('invalid');
  return value > max ? fail('max') : ok(value);
}

/** Somoni with two decimals at most → dirams (F12); more decimals are refused, not rounded. Null when empty. */
export function parseMoney(cell: Cell): Parsed<number | null> {
  if (cell === null) return ok(null);
  const minor = parseMoneyToMinor(cell.text);
  return minor === null ? fail('invalid') : ok(minor);
}

const YES = ['да', 'yes', 'true', '1', '+', 'x', 'х', 'ҳа', 'истина'];
const NO = ['нет', 'no', 'false', '0', '-', '—', 'не', 'ложь'];

/** да / нет and their kin; an empty cell is «no». */
export function parseBoolean(cell: Cell): Parsed<boolean> {
  const text = words(cell);
  if (text === '') return ok(false);
  if (YES.includes(text)) return ok(true);
  return NO.includes(text) ? ok(false) : fail('invalid');
}

const UNITS: Record<ProductUnit, readonly string[]> = {
  pack: ['уп', 'упак', 'упаковка', 'пачка', 'пач', 'pack', 'қуттӣ'],
  piece: ['шт', 'штука', 'штук', 'piece', 'pcs', 'дона'],
  ml: ['мл', 'ml', 'миллилитр'],
};

/** The unit of the card; an empty cell is a pack. */
export function parseUnit(cell: Cell): Parsed<ProductUnit> {
  const text = words(cell).replace(/\.$/, '');
  if (text === '') return ok('pack');
  const unit = (Object.keys(UNITS) as ProductUnit[]).find((key) =>
    UNITS[key].includes(text),
  );
  return unit ? ok(unit) : fail('invalid');
}

const PRESCRIPTIONS: Record<PrescriptionKind, readonly string[]> = {
  none: ['без рецепта', 'безрецептурный', 'otc', ...NO],
  rx: ['по рецепту', 'рецептурный', 'рецепт', 'rx', ...YES],
  controlled: [
    'пку',
    'контролируемый',
    'предметно-количественный учет',
    'предметно-количественный учёт',
  ].map(matchKey),
};

/** The way of dispensing; an empty cell is «without a prescription». */
export function parsePrescription(cell: Cell): Parsed<PrescriptionKind> {
  const text = words(cell);
  if (text === '') return ok('none');
  const kind = (Object.keys(PRESCRIPTIONS) as PrescriptionKind[]).find((key) =>
    PRESCRIPTIONS[key].includes(text),
  );
  return kind ? ok(kind) : fail('invalid');
}

/**
 * A country by its RU or TJ name or its ISO code; an unknown one stays empty with a warning (F6, F13), the country of
 * a card is not required.
 */
export function parseCountry(cell: Cell): { code: string; unknown: boolean } {
  if (cell === null) return { code: '', unknown: false };
  const code = cell.text.trim().toUpperCase();
  if (isCountryCode(code)) return { code, unknown: false };
  const key = matchKey(cell.text);
  const found = countries.find(
    (country) =>
      matchKey(country.name.ru) === key || matchKey(country.name.tj) === key,
  );
  return found
    ? { code: found.code, unknown: false }
    : { code: '', unknown: true };
}

/** A markup in percent, 0–1000; a percent cell of Excel stores a fraction (0.25 for 25 %). Null when empty. */
export function parseMarkup(cell: Cell): Parsed<number | null> {
  if (cell === null) return ok(null);
  let value: number;
  if (cell.number !== null) {
    value =
      cell.number > 0 && cell.number < 1 ? cell.number * 100 : cell.number;
    value = Math.round(value * 1e6) / 1e6;
  } else {
    const text = cell.text.replace(/[\s%]/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(text)) return fail('invalid');
    value = Number(text);
  }
  if (!Number.isInteger(value) || value < 0) return fail('invalid');
  return value > 1000 ? fail('max') : ok(value);
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    year < 1900 ||
    year > 9999
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * The expiry date (F11): a date of Excel, `ДД.ММ.ГГГГ` (or `/`, `-`, a two-digit year is 20xx), `ГГГГ-ММ-ДД`, or
 * `ММ.ГГГГ` — the last day of the month, as an expiry «12.2027» means.
 */
export function parseExpiry(cell: Cell, date1904: boolean): Parsed<string> {
  if (cell === null) return fail('required');
  if (cell.number !== null) {
    const date = excelSerialToDate(cell.number, date1904);
    return date ? ok(date) : fail('invalid');
  }
  const text = cell.text.trim();
  let match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(text);
  if (match) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const date = isoDate(year, Number(match[2]), Number(match[1]));
    return date ? ok(date) : fail('invalid');
  }
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/.exec(text);
  if (match) {
    const date = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return date ? ok(date) : fail('invalid');
  }
  match = /^(\d{1,2})[./](\d{4})$/.exec(text);
  if (match) {
    const month = Number(match[1]);
    if (month < 1 || month > 12) return fail('invalid');
    const last = new Date(Date.UTC(Number(match[2]), month, 0)).getUTCDate();
    const date = isoDate(Number(match[2]), month, last);
    return date ? ok(date) : fail('invalid');
  }
  return fail('invalid');
}
