import { importLimits } from '@pharmacy/shared-domain';
import type {
  CatalogImportRequest,
  CatalogImportRow,
  ImportIssue,
  OpeningBalanceImportRequest,
  OpeningBalanceImportRow,
  SupplierImportRequest,
  SupplierImportRow,
} from '@pharmacy/shared-dto';
import { matchKey } from '@pharmacy/shared-util';
import {
  type Cell,
  type Sheet,
  SpreadsheetError,
} from '@/shared/lib/spreadsheet';
import {
  type Parsed,
  parseBarcodes,
  parseBoolean,
  parseCountry,
  parseExpiry,
  parseInteger,
  parseMarkup,
  parseMoney,
  parsePrescription,
  parseText,
  parseUnit,
} from './values';

/**
 * The values of the catalog the employee chose (spec 2026-10-20-data-import, F6): a category of the file → the name of
 * an active category or of a new one; a form of the file → a form of the dosage forms of the network or ''. Keys are
 * `matchKey` of the file values.
 */
export interface CatalogExtras {
  kind: 'catalog';
  categories: Readonly<Record<string, string>>;
  forms: Readonly<Record<string, string>>;
  /** For rows without a category. */
  defaultCategory: string;
}

export interface BalanceExtras {
  kind: 'opening-balances';
  storeId: string;
  date: string;
  comment: string;
}

export type BuildExtras = CatalogExtras | BalanceExtras | { kind: 'suppliers' };

export type ImportRequest =
  | { kind: 'catalog'; body: CatalogImportRequest }
  | { kind: 'opening-balances'; body: OpeningBalanceImportRequest }
  | { kind: 'suppliers'; body: SupplierImportRequest };

export interface BuildInput {
  sheet: Sheet;
  headerRow: number;
  /** The field of each column, null — not loaded. */
  mapping: readonly (string | null)[];
  date1904: boolean;
  fileName: string;
  extras: BuildExtras;
}

export interface BuildResult {
  request: ImportRequest;
  /** Cells the browser could not read; their rows are not sent. */
  clientIssues: ImportIssue[];
  /** Read with a value left empty (an unknown country). */
  warnings: ImportIssue[];
  /** Rows of opening balances with a quantity of 0 — not loaded. */
  skippedZero: number;
  dataRows: number;
}

/** Reads the cells of a row: one column of a field, or all the columns of a `multiple` field. */
function rowReader(mapping: readonly (string | null)[]) {
  const columns = new Map<string, number[]>();
  mapping.forEach((key, index) => {
    if (key !== null) columns.set(key, [...(columns.get(key) ?? []), index]);
  });
  return (row: readonly Cell[]) => ({
    cell: (key: string): Cell => {
      const [index] = columns.get(key) ?? [];
      return index === undefined ? null : (row[index] ?? null);
    },
    cells: (key: string): Cell[] =>
      (columns.get(key) ?? []).map((index) => row[index] ?? null),
  });
}

/** The data rows under the header: line = row of the sheet as Excel numbers it; empty rows are skipped. */
function dataRowsOf(sheet: Sheet, headerRow: number) {
  return sheet.rows
    .map((row, index) => ({ row, line: index + 1 }))
    .slice(headerRow + 1)
    .filter(({ row }) => row.some((cell) => cell !== null));
}

/**
 * The distinct values of a field in the file (the step «Values»): key, text as first written, rows; `empty` — data
 * rows without a value.
 */
export function distinctValues(
  sheet: Sheet,
  headerRow: number,
  mapping: readonly (string | null)[],
  field: string,
): { values: { key: string; text: string; rows: number }[]; empty: number } {
  const read = rowReader(mapping);
  const values = new Map<string, { key: string; text: string; rows: number }>();
  let empty = 0;
  for (const { row } of dataRowsOf(sheet, headerRow)) {
    const parsed = parseText(read(row).cell(field), 200);
    if (!parsed.ok) continue;
    if (parsed.value === '') {
      empty += 1;
      continue;
    }
    const key = matchKey(parsed.value);
    const known = values.get(key);
    if (known) known.rows += 1;
    else values.set(key, { key, text: parsed.value, rows: 1 });
  }
  return { values: [...values.values()], empty };
}

/**
 * The request of a load (section 4): every data row read by the parsers of its fields. A row with a cell that cannot
 * be read is not sent and becomes an issue; the check of the API sees only readable rows.
 */
export function buildRequest(input: BuildInput): BuildResult {
  const rows = dataRowsOf(input.sheet, input.headerRow);
  const limit =
    input.extras.kind === 'suppliers'
      ? importLimits.supplierRows
      : importLimits.rows;
  if (rows.length > limit) throw new SpreadsheetError('too_many_rows');

  const read = rowReader(input.mapping);
  const clientIssues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  let skippedZero = 0;

  /** The value of a parser, or undefined after the issue of the row is recorded. */
  const take = <T>(
    line: number,
    field: string,
    parsed: Parsed<T>,
  ): T | undefined => {
    if (parsed.ok) return parsed.value;
    clientIssues.push({ line, field, code: parsed.code });
    return undefined;
  };
  const barcodesOf = (line: number, cells: Cell[]): string[] | undefined => {
    const codes: string[] = [];
    for (const cell of cells) {
      const parsed = take(line, 'barcodes', parseBarcodes(cell));
      if (parsed === undefined) return undefined;
      codes.push(...parsed);
    }
    return [...new Set(codes)];
  };

  const extras = input.extras;
  if (extras.kind === 'catalog') {
    const out: CatalogImportRow[] = [];
    for (const { row, line } of rows) {
      const cells = read(row);
      const before = clientIssues.length;
      const text = (field: string, max: number) =>
        take(line, field, parseText(cells.cell(field), max)) ?? '';
      const nameRu = text('nameRu', 200);
      const nameTj = text('nameTj', 200);
      const barcodes = barcodesOf(line, cells.cells('barcodes')) ?? [];
      const categoryText = text('category', 200);
      const category =
        categoryText === ''
          ? extras.defaultCategory
          : (extras.categories[matchKey(categoryText)] ?? categoryText);
      if (category.length > 100) {
        clientIssues.push({ line, field: 'category', code: 'max' });
      }
      const formText = text('form', 200);
      const form =
        formText === '' ? '' : (extras.forms[matchKey(formText)] ?? '');
      const country = parseCountry(cells.cell('countryCode'));
      if (country.unknown) {
        warnings.push({ line, field: 'countryCode', code: 'unknown_country' });
      }
      const maxPrice = take(
        line,
        'maxPriceMinor',
        parseMoney(cells.cell('maxPriceMinor')),
      );
      const parsed: CatalogImportRow = {
        line,
        nameRu,
        nameTj,
        barcodes,
        category,
        form,
        dosage: text('dosage', 200),
        inn: text('inn', 200),
        manufacturer: text('manufacturer', 200),
        countryCode: country.code,
        unit: take(line, 'unit', parseUnit(cells.cell('unit'))) ?? 'pack',
        piecesPerPack:
          take(
            line,
            'piecesPerPack',
            parseInteger(cells.cell('piecesPerPack'), 1, 10_000, 1),
          ) ?? 1,
        divisible:
          take(line, 'divisible', parseBoolean(cells.cell('divisible'))) ??
          false,
        prescription:
          take(
            line,
            'prescription',
            parsePrescription(cells.cell('prescription')),
          ) ?? 'none',
        // a regulated price of 0 means «not regulated» in the files of other systems
        maxPriceMinor:
          maxPrice === undefined || maxPrice === 0 ? null : maxPrice,
        markupPercent:
          take(
            line,
            'markupPercent',
            parseMarkup(cells.cell('markupPercent')),
          ) ?? null,
        minStockPacks:
          take(
            line,
            'minStockPacks',
            parseInteger(cells.cell('minStockPacks'), 0, 1_000_000, 0),
          ) ?? 0,
      };
      if (clientIssues.length === before) out.push(parsed);
    }
    return {
      request: {
        kind: 'catalog',
        body: { fileName: input.fileName, rows: out },
      },
      clientIssues,
      warnings,
      skippedZero,
      dataRows: rows.length,
    };
  }

  if (extras.kind === 'opening-balances') {
    const out: OpeningBalanceImportRow[] = [];
    for (const { row, line } of rows) {
      const cells = read(row);
      const before = clientIssues.length;
      const text = (field: string, max: number) =>
        take(line, field, parseText(cells.cell(field), max)) ?? '';
      const quantity = take(
        line,
        'quantity',
        parseInteger(cells.cell('quantity'), 0, 100_000, null),
      );
      if (quantity === 0) {
        // a product out of stock: nothing to load (F11)
        skippedZero += 1;
        clientIssues.length = before;
        continue;
      }
      const barcodes = barcodesOf(line, cells.cells('barcodes')) ?? [];
      const name = text('name', 200);
      if (
        barcodes.length === 0 &&
        name === '' &&
        clientIssues.length === before
      ) {
        clientIssues.push({ line, field: 'name', code: 'required' });
      }
      const cost = take(line, 'costMinor', parseMoney(cells.cell('costMinor')));
      if (cost === null) {
        clientIssues.push({ line, field: 'costMinor', code: 'required' });
      }
      const retail = take(
        line,
        'retailPriceMinor',
        parseMoney(cells.cell('retailPriceMinor')),
      );
      const parsed: OpeningBalanceImportRow = {
        line,
        barcodes,
        name,
        form: text('form', 200),
        dosage: text('dosage', 200),
        batchNumber: text('batchNumber', 60),
        expiresOn:
          take(
            line,
            'expiresOn',
            parseExpiry(cells.cell('expiresOn'), input.date1904),
          ) ?? '',
        quantity: quantity ?? 0,
        costMinor: cost ?? 0,
        retailPriceMinor: retail === undefined || retail === 0 ? null : retail,
      };
      if (clientIssues.length === before) out.push(parsed);
    }
    return {
      request: {
        kind: 'opening-balances',
        body: {
          fileName: input.fileName,
          storeId: extras.storeId,
          date: extras.date,
          comment: extras.comment,
          rows: out,
        },
      },
      clientIssues,
      warnings,
      skippedZero,
      dataRows: rows.length,
    };
  }

  const out: SupplierImportRow[] = [];
  for (const { row, line } of rows) {
    const cells = read(row);
    const before = clientIssues.length;
    const text = (field: string, max: number) =>
      take(line, field, parseText(cells.cell(field), max)) ?? '';
    const name = text('name', 200);
    if (name === '' && clientIssues.length === before) {
      clientIssues.push({ line, field: 'name', code: 'required' });
    }
    const taxId = text('taxId', 60).replace(/\s+/g, '');
    if (taxId !== '' && !/^[0-9]{9}$/.test(taxId)) {
      clientIssues.push({ line, field: 'taxId', code: 'invalid' });
    }
    const parsed: SupplierImportRow = {
      line,
      name,
      taxId,
      phone: text('phone', 60),
      address: text('address', 300),
      paymentDelayDays:
        take(
          line,
          'paymentDelayDays',
          parseInteger(cells.cell('paymentDelayDays'), 0, 365, 0),
        ) ?? 0,
    };
    if (clientIssues.length === before) out.push(parsed);
  }
  return {
    request: {
      kind: 'suppliers',
      body: { fileName: input.fileName, rows: out },
    },
    clientIssues,
    warnings,
    skippedZero,
    dataRows: rows.length,
  };
}
