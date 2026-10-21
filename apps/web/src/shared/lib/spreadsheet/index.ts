import { importLimits } from '@pharmacy/shared-domain';
import { SpreadsheetError, type Workbook } from './cells';
import { readCsv } from './csv';
import { readXlsx } from './xlsx';

export {
  type Cell,
  type Sheet,
  SpreadsheetError,
  type SpreadsheetErrorCode,
  type Workbook,
} from './cells';
export { excelSerialToDate } from './dates';

/**
 * Reads an .xlsx or a .csv in the browser, without libraries (spec 2026-10-20-data-import, F2, F3; ADR-0015,
 * amendment 2026-10-20). The first bytes decide: a zip is an .xlsx, a compound file (`D0 CF 11 E0`) is an .xls of
 * Excel 97–2003 or a file with a password, anything else is read as a CSV.
 */
export async function readSpreadsheet(file: File): Promise<Workbook> {
  if (file.size > importLimits.fileBytes) {
    throw new SpreadsheetError('too_large');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new SpreadsheetError('empty');

  let workbook: Workbook;
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    workbook = await readXlsx(bytes);
  } else if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    throw new SpreadsheetError('legacy_or_encrypted');
  } else {
    // a binary file (a PDF, an image) has NUL bytes; a CSV in UTF-16 starts with its BOM
    const head = bytes.subarray(0, 1024);
    const utf16 =
      (head[0] === 0xff && head[1] === 0xfe) ||
      (head[0] === 0xfe && head[1] === 0xff);
    if (!utf16 && head.includes(0)) throw new SpreadsheetError('unsupported');
    workbook = readCsv(bytes);
  }

  const sheets = workbook.sheets.filter(
    (sheet) =>
      sheet.tooLarge === true ||
      sheet.rows.some((row) => row.some((cell) => cell !== null)),
  );
  if (sheets.length === 0) throw new SpreadsheetError('empty');
  return { ...workbook, sheets };
}
