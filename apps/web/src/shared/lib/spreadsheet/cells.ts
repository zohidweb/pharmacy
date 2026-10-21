/**
 * A cell of a sheet (spec 2026-10-20-data-import, 3.2): its text, and for a number cell of an .xlsx the number too.
 * The text of a number is the value as the file stores it (`4600000000017`, `12.5`), not as Excel formats it, so
 * barcodes and money keep every digit.
 */
export type Cell = null | { text: string; number: number | null };

export interface Workbook {
  /** The 1904 date system of the workbook (Excel for Mac); dates of the cells are serial numbers of it. */
  date1904: boolean;
  /** The visible sheets in their order; row i is line i + 1 of the sheet, as Excel shows it. */
  sheets: { name: string; rows: Cell[][] }[];
}

export type Sheet = Workbook['sheets'][number];

export type SpreadsheetErrorCode =
  | 'too_large'
  | 'legacy_or_encrypted'
  | 'unsupported'
  | 'corrupt'
  | 'empty'
  | 'too_many_rows';

/** Why a file is not read; the screen shows a message per code. */
export class SpreadsheetError extends Error {
  constructor(readonly code: SpreadsheetErrorCode) {
    super(code);
    this.name = 'SpreadsheetError';
  }
}

/**
 * The text of a cell as the rows read it (3.4): NFC, the no-break space and tabs become spaces, spaces repeat once,
 * nothing at the ends. Line breaks stay: they separate the barcodes of one cell.
 */
export function cleanCellText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/ *(\r\n|\r|\n) */g, '\n')
    .trim();
}

/** A cell of text, or null for an empty one. */
export function textCell(value: string, number: number | null = null): Cell {
  const text = cleanCellText(value);
  return text === '' ? null : { text, number };
}
