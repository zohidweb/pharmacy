/**
 * Writing an Excel workbook of one sheet (ADR-0015, amendment 2026-10-27; plan 2026-10-27-excel-export, X3–X5): the
 * minimal SpreadsheetML package — content types, relations, workbook, styles, sheet — with inline strings, zipped by
 * own code. Pure: no DOM, so web, admin and Node share it.
 */
import { APP_TIME_ZONE } from '../date';
import { zipFiles } from './zip';

/** The most rows an export asks the API for at once (the audit log, stock). */
export const EXPORT_ROW_LIMIT = 20_000;

export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type XlsxCell =
  | null
  | { kind: 'text'; value: string }
  | { kind: 'integer'; value: number }
  | { kind: 'money'; minor: number }
  /** 12.5 → 12,5 % */
  | { kind: 'percent'; value: number }
  /** YYYY-MM-DD */
  | { kind: 'date'; value: string }
  /** an ISO instant, shown in APP_TIME_ZONE */
  | { kind: 'dateTime'; value: string };

type Value<T> = T | null | undefined;

/** Cell builders; null, undefined and an empty text give an empty cell. */
export const xlsxCell = {
  text: (value: Value<string>): XlsxCell =>
    value === null || value === undefined || value === ''
      ? null
      : { kind: 'text', value },
  integer: (value: Value<number>): XlsxCell =>
    value === null || value === undefined ? null : { kind: 'integer', value },
  money: (minor: Value<number>): XlsxCell =>
    minor === null || minor === undefined ? null : { kind: 'money', minor },
  percent: (value: Value<number>): XlsxCell =>
    value === null || value === undefined ? null : { kind: 'percent', value },
  date: (value: Value<string>): XlsxCell =>
    value ? { kind: 'date', value } : null,
  dateTime: (value: Value<string>): XlsxCell =>
    value ? { kind: 'dateTime', value } : null,
};

export interface XlsxSheet {
  name: string;
  /** Lines above the table; the first one bold. */
  heading: readonly string[];
  columns: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /** Indexes of `rows` written bold: subtotal rows, as the group rows of the screen. */
  boldRows?: ReadonlySet<number>;
  /**
   * The total row, bold, after one empty row: Excel widens the auto filter over a row that touches the data, and a sort
   * from the header would move the total among the rows.
   */
  total?: readonly XlsxCell[];
}

const MAX_ROWS = 1_048_576;
const MAX_TEXT = 32_767;
const DAY_MS = 86_400_000;
// the serial number of 1970-01-01 in the 1900 date system of Excel
const UNIX_EPOCH_SERIAL = 25_569;
// characters XML 1.0 does not allow, lone surrogates included (Excel refuses such a file as damaged)
const INVALID_XML =
  // the complement of the Char production of XML 1.0, written as escapes: the range ends are invisible characters
  // eslint-disable-next-line no-control-regex -- the controls XML 1.0 allows are named on purpose
  /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/g;
// eslint-disable-next-line no-control-regex -- control characters are not allowed in a Windows file name
const FILE_NAME_FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F]/g;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// cellXfs of styles.xml, by index
const STYLE = {
  plain: 0,
  bold: 1,
  integer: 2,
  money: 3,
  percent: 4,
  date: 5,
  dateTime: 6,
  boldInteger: 7,
  boldMoney: 8,
  boldPercent: 9,
} as const;

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function clean(value: string): string {
  // cut first: a cut surrogate pair leaves a lone half, which the filter then removes
  return value.slice(0, MAX_TEXT).replace(INVALID_XML, '');
}

function escapeXml(value: string): string {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** Somoni with two decimals from integer dirams, without floating division. */
function moneyText(minor: number): string {
  const abs = Math.abs(minor);
  const dirams = abs % 100;
  const sign = minor < 0 ? '-' : '';
  return `${sign}${(abs - dirams) / 100}.${String(dirams).padStart(2, '0')}`;
}

function dateSerial(value: string): number | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return utc / DAY_MS + UNIX_EPOCH_SERIAL;
}

/** The wall time of an instant in the time zone of the application, as an Excel serial number. */
function dateTimeSerial(value: string): number | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const part = Object.fromEntries(
    wallClock.formatToParts(instant).map((p) => [p.type, Number(p.value)]),
  );
  const utc = Date.UTC(
    part.year,
    part.month - 1,
    part.day,
    part.hour,
    part.minute,
    part.second,
  );
  return utc / DAY_MS + UNIX_EPOCH_SERIAL;
}

function textCell(ref: string, value: string, style: number): string {
  const s = style === STYLE.plain ? '' : ` s="${style}"`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: string, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function cellXml(ref: string, cell: XlsxCell, bold: boolean): string {
  if (cell === null) return '';
  switch (cell.kind) {
    case 'text':
      return cell.value === ''
        ? ''
        : textCell(ref, cell.value, bold ? STYLE.bold : STYLE.plain);
    case 'integer':
      return Number.isFinite(cell.value)
        ? numberCell(
            ref,
            String(cell.value),
            bold ? STYLE.boldInteger : STYLE.integer,
          )
        : '';
    case 'money':
      return Number.isSafeInteger(cell.minor)
        ? numberCell(
            ref,
            moneyText(cell.minor),
            bold ? STYLE.boldMoney : STYLE.money,
          )
        : '';
    case 'percent':
      return Number.isFinite(cell.value)
        ? numberCell(
            ref,
            String(cell.value / 100),
            bold ? STYLE.boldPercent : STYLE.percent,
          )
        : '';
    case 'date': {
      const serial = dateSerial(cell.value);
      return serial === null
        ? textCell(ref, cell.value, STYLE.plain)
        : numberCell(ref, String(serial), STYLE.date);
    }
    case 'dateTime': {
      const serial = dateTimeSerial(cell.value);
      return serial === null
        ? textCell(ref, cell.value, STYLE.plain)
        : numberCell(ref, String(serial), STYLE.dateTime);
    }
  }
}

/** The width a value takes in characters, for the column width. */
function cellLength(cell: XlsxCell): number {
  if (cell === null) return 0;
  const grouped = (digits: number) => digits + Math.floor((digits - 1) / 3);
  switch (cell.kind) {
    case 'text':
      return Math.min(cell.value.length, 200);
    case 'integer':
      return grouped(String(Math.trunc(Math.abs(cell.value))).length) + 1;
    case 'money':
      return grouped(String(Math.trunc(Math.abs(cell.minor) / 100)).length) + 4;
    case 'percent':
      return 7;
    case 'date':
      return 10;
    case 'dateTime':
      return 16;
  }
}

/**
 * The longest start of `value` within `units` UTF-16 units, as Excel and Windows count a name, by whole code points: a
 * cut never leaves half of a surrogate pair, and an emoji takes two of the units.
 */
function cut(value: string, units: number): string {
  let start = '';
  for (const char of value) {
    if (start.length + char.length > units) break;
    start += char;
  }
  return start;
}

function sheetName(name: string): string {
  // Excel forbids an apostrophe at either end: stripped after the cut, which may bring one to the end
  const cleaned = cut(
    clean(name).replace(SHEET_NAME_FORBIDDEN, ' ').trim(),
    31,
  ).replace(/^['\s]+|['\s]+$/g, '');
  return cleaned || 'Sheet1';
}

function rowXml(
  index: number,
  cells: readonly XlsxCell[],
  bold: boolean,
): string {
  const xml = cells
    .map((cell, column) => cellXml(`${columnName(column)}${index}`, cell, bold))
    .join('');
  return `<row r="${index}">${xml}</row>`;
}

function worksheetXml(sheet: XlsxSheet, headerRow: number): string {
  const lastColumn = columnName(sheet.columns.length - 1);
  const lastData = headerRow + sheet.rows.length;
  const lastRow = lastData + (sheet.total ? 2 : 0);
  const rows: string[] = sheet.heading.map((line, i) =>
    rowXml(i + 1, [xlsxCell.text(line)], i === 0),
  );
  rows.push(
    rowXml(
      headerRow,
      sheet.columns.map((header) => xlsxCell.text(header)),
      true,
    ),
  );
  sheet.rows.forEach((cells, i) =>
    rows.push(
      rowXml(headerRow + 1 + i, cells, sheet.boldRows?.has(i) ?? false),
    ),
  );
  if (sheet.total) rows.push(rowXml(lastRow, sheet.total, true));

  const widths = sheet.columns.map((header, column) => {
    let length = header.length;
    for (const cells of sheet.rows) {
      length = Math.max(length, cellLength(cells[column] ?? null));
    }
    if (sheet.total) {
      length = Math.max(length, cellLength(sheet.total[column] ?? null));
    }
    return Math.min(Math.max(length + 2, 8), 60);
  });
  const cols = widths
    .map(
      (width, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`,
    )
    .join('');

  const top = `A${headerRow + 1}`;
  return (
    XML_HEAD +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    // readers that stream the sheet (openpyxl in read-only mode) take the size from here
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="${headerRow}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="${top}" sqref="${top}"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    `<autoFilter ref="A${headerRow}:${lastColumn}${lastData}"/>` +
    `</worksheet>`
  );
}

function workbookXml(name: string, filterRange: string): string {
  const quoted = `'${name.replace(/'/g, "''")}'`;
  return (
    XML_HEAD +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">` +
    `${escapeXml(quoted)}!${filterRange}</definedName></definedNames>` +
    `</workbook>`
  );
}

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  XML_HEAD +
  `<Relationships xmlns="${PACKAGE_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';

const WORKBOOK_RELS =
  XML_HEAD +
  `<Relationships xmlns="${PACKAGE_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/>` +
  '</Relationships>';

const xf = (numFmtId: number, bold: boolean) =>
  `<xf numFmtId="${numFmtId}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"` +
  `${numFmtId === 0 ? '' : ' applyNumberFormat="1"'}${bold ? ' applyFont="1"' : ''}/>`;

// the order follows STYLE
const STYLES =
  XML_HEAD +
  `<styleSheet xmlns="${MAIN_NS}">` +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0%"/>' +
  '<numFmt numFmtId="165" formatCode="dd.mm.yyyy"/>' +
  '<numFmt numFmtId="166" formatCode="dd.mm.yyyy hh:mm"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  `<cellXfs count="10">${[
    xf(0, false),
    xf(0, true),
    xf(3, false),
    xf(4, false),
    xf(164, false),
    xf(165, false),
    xf(166, false),
    xf(3, true),
    xf(4, true),
    xf(164, true),
  ].join('')}</cellXfs>` +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** The bytes of an `.xlsx` file of one sheet (plan 2026-10-27-excel-export, X3–X5). */
export async function xlsxBytes(
  sheet: XlsxSheet,
): Promise<Uint8Array<ArrayBuffer>> {
  if (sheet.columns.length === 0) {
    throw new RangeError('A sheet needs at least one column');
  }
  const headerRow = sheet.heading.length === 0 ? 1 : sheet.heading.length + 2;
  const lastRow = headerRow + sheet.rows.length + (sheet.total ? 2 : 0);
  if (lastRow > MAX_ROWS) {
    throw new RangeError(`A sheet holds at most ${MAX_ROWS} rows`);
  }
  const name = sheetName(sheet.name);
  const lastColumn = columnName(sheet.columns.length - 1);
  const filterRange = `$A$${headerRow}:$${lastColumn}$${headerRow + sheet.rows.length}`;
  const encoder = new TextEncoder();
  return zipFiles(
    [
      ['[Content_Types].xml', CONTENT_TYPES],
      ['_rels/.rels', ROOT_RELS],
      ['xl/workbook.xml', workbookXml(name, filterRange)],
      ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
      ['xl/styles.xml', STYLES],
      ['xl/worksheets/sheet1.xml', worksheetXml(sheet, headerRow)],
    ].map(([path, text]) => ({ name: path, data: encoder.encode(text) })),
  );
}

/** A file name of the parts («Продажи по точкам 01.10.2026–27.10.2026» + `.xlsx`), safe for Windows. */
export function xlsxFileName(
  ...parts: readonly (string | null | undefined)[]
): string {
  const joined = parts
    .filter((part): part is string => !!part && part.trim() !== '')
    .join(' ')
    .replace(FILE_NAME_FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // cut as the sheet name; Windows drops a trailing dot or space
  const name = cut(joined, 150).replace(/[. ]+$/, '');
  return `${name || 'export'}.xlsx`;
}
