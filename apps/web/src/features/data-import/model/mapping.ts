import { matchKey } from '@pharmacy/shared-util';
import type { Cell } from '@/shared/lib/spreadsheet';
import { type FieldDef, type ImportKindKey, kindFields } from './fields';

/** Rows above the header a file may have (a title, a date, an empty line). */
const HEADER_SEARCH_ROWS = 20;

/** A header as the synonyms are written: `matchKey`, without `. , № % ( ) : ; *` and repeated spaces. */
export function normalizeHeader(value: string): string {
  return matchKey(value.replace(/[.,№%():;*]/g, ' '));
}

/**
 * The field of a header (spec 2026-10-20-data-import, F5): a synonym equal to it, else the longest synonym it starts
 * with («наименование товара» → «наименование»).
 */
export function matchField(
  header: string,
  fields: readonly FieldDef[],
): FieldDef | null {
  const key = normalizeHeader(header);
  if (key === '') return null;
  const exact = fields.find((field) => field.synonyms.includes(key));
  if (exact) return exact;
  let best: { field: FieldDef; length: number } | null = null;
  for (const field of fields) {
    for (const synonym of field.synonyms) {
      if (
        key.startsWith(`${synonym} `) &&
        synonym.length > (best?.length ?? 0)
      ) {
        best = { field, length: synonym.length };
      }
    }
  }
  return best?.field ?? null;
}

/** The texts of a row as headers; an empty cell is ''. */
export function headersOf(row: readonly Cell[] | undefined): string[] {
  return Array.from(row ?? [], (cell) => cell?.text ?? '');
}

/**
 * The row of the headers (F5): the first of the first 20 rows where two fields are recognized, else the first row
 * that is not empty; -1 for a sheet without data.
 */
export function detectHeaderRow(
  rows: readonly (readonly Cell[])[],
  kind: ImportKindKey,
): number {
  const fields = kindFields[kind];
  let firstFilled = -1;
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i += 1) {
    const headers = headersOf(rows[i]);
    if (headers.every((header) => header === '')) continue;
    if (firstFilled < 0) firstFilled = i;
    const known = new Set(
      headers
        .map((header) => matchField(header, fields)?.key)
        .filter((key) => key !== undefined),
    );
    if (known.size >= 2) return i;
  }
  if (firstFilled >= 0) return firstFilled;
  return rows.findIndex((row) => row.some((cell) => cell !== null));
}

/** The field suggested for each column; a field takes one column, unless it is `multiple`. */
export function suggestMapping(
  headers: readonly string[],
  kind: ImportKindKey,
): (string | null)[] {
  const fields = kindFields[kind];
  const taken = new Set<string>();
  return headers.map((header) => {
    const field = matchField(header, fields);
    if (!field || (taken.has(field.key) && !field.multiple)) return null;
    taken.add(field.key);
    return field.key;
  });
}

/**
 * The required fields without a column: every `yes` field, and the `one-of` group when none of it has one (its keys
 * joined by `|`).
 */
export function missingFields(
  mapping: readonly (string | null)[],
  kind: ImportKindKey,
): string[] {
  const fields = kindFields[kind];
  const mapped = new Set(mapping.filter((key) => key !== null));
  const missing = fields
    .filter((field) => field.required === 'yes' && !mapped.has(field.key))
    .map((field) => field.key);
  const oneOf = fields.filter((field) => field.required === 'one-of');
  if (oneOf.length > 0 && !oneOf.some((field) => mapped.has(field.key))) {
    missing.push(oneOf.map((field) => field.key).join('|'));
  }
  return missing;
}

/** The letter of a column as Excel names it: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}
