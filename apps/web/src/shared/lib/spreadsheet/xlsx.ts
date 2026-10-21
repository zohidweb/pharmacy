import { importLimits } from '@pharmacy/shared-domain';
import { type Cell, SpreadsheetError, type Workbook, textCell } from './cells';
import { readZipDirectory, readZipEntry } from './zip';

/** Rows with data a sheet may hold — data rows plus title rows; a sheet past it is marked `tooLarge`. */
const MAX_SHEET_ROWS = importLimits.rows + 100;
/** A row with data this far down is not a list of a network: the sheet is marked `tooLarge`. */
const MAX_ROW_INDEX = MAX_SHEET_ROWS * 10;

/** The built-in number formats of Excel that matter here (ECMA-376, 18.8.30): percents and dates. */
const BUILTIN_FORMATS: Readonly<Record<number, string>> = {
  9: '0%',
  10: '0.00%',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  22: 'm/d/yy h:mm',
};

/** What the number format of a cell style tells about its value. */
interface CellStyle {
  /** A date without a day: «12.2027» typed into a cell is stored as 01.12.2027. */
  monthOnly: boolean;
  /** A percent: 1 is 100 %. */
  percent: boolean;
  /** «0000000000000»: the leading zeros of a code are shown, not stored. */
  zeroPad: number;
}

const corrupt = () => new SpreadsheetError('corrupt');

/** Elements by local name in any namespace: Transitional and Strict OOXML alike. */
const byName = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagNameNS('*', name));

const childrenByName = (parent: Element, name: string): Element[] =>
  Array.from(parent.children).filter((child) => child.localName === name);

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw corrupt();
  return doc;
}

/** `B12` → column 1 (zero-based); null without a reference. */
function columnOf(ref: string | null): number | null {
  const letters = ref ? /^([A-Z]+)/i.exec(ref)?.[1] : undefined;
  if (!letters) return null;
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** The text of a rich string (`<si>`, `<is>`): its `<t>` runs, without the phonetic `<rPh>`. */
function richText(element: Element): string {
  return byName(element, 't')
    .filter((t) => {
      for (
        let node = t.parentElement;
        node && node !== element;
        node = node.parentElement
      ) {
        if (node.localName === 'rPh') return false;
      }
      return true;
    })
    .map((t) => t.textContent ?? '')
    .join('');
}

/** The id of the relationship of a `<sheet>`: `r:id` of whatever namespace the file uses. */
function relationshipId(sheet: Element): string | null {
  const attribute = Array.from(sheet.attributes).find(
    (item) => item.localName === 'id' && item.namespaceURI !== null,
  );
  return attribute?.value ?? null;
}

/** `worksheets/sheet1.xml`, relative to `xl/`, or absolute from the root of the package. */
function packagePath(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `xl/${target}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/** A number format code read for its meaning: literals in quotes, escaped characters and `[…]` sections are not tokens. */
function styleOf(format: string): CellStyle {
  const code = format
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .toLowerCase();
  return {
    monthOnly:
      code.includes('y') &&
      code.includes('m') &&
      !code.includes('d') &&
      !code.includes('h') &&
      !code.includes('s'),
    percent: code.includes('%'),
    zeroPad: /^0{2,}$/.test(code) ? code.length : 0,
  };
}

/** The style of every `xf` of `cellXfs` (the `s` of a cell is its index). */
function cellStyles(stylesXml: string | null): CellStyle[] {
  if (stylesXml === null) return [];
  const doc = parseXml(stylesXml);
  const formats = new Map<number, string>(
    Object.entries(BUILTIN_FORMATS).map(([id, code]) => [Number(id), code]),
  );
  for (const format of byName(doc, 'numFmt')) {
    formats.set(
      Number(format.getAttribute('numFmtId')),
      format.getAttribute('formatCode') ?? '',
    );
  }
  const cellXfs = byName(doc, 'cellXfs')[0];
  if (!cellXfs) return [];
  return childrenByName(cellXfs, 'xf').map((xf) =>
    styleOf(formats.get(Number(xf.getAttribute('numFmtId') ?? '0')) ?? ''),
  );
}

function readCell(
  cell: Element,
  shared: readonly string[],
  styles: readonly CellStyle[],
): Cell {
  const type = cell.getAttribute('t') ?? 'n';
  const value = childrenByName(cell, 'v')[0]?.textContent ?? '';
  switch (type) {
    case 's': {
      const index = Number(value);
      return Number.isInteger(index) && index >= 0 && index < shared.length
        ? textCell(shared[index])
        : null;
    }
    case 'inlineStr': {
      const inline = childrenByName(cell, 'is')[0];
      return inline ? textCell(richText(inline)) : null;
    }
    case 'str':
    case 'd':
      return textCell(value);
    case 'b':
      return value === '' ? null : textCell(value === '1' ? 'true' : 'false');
    case 'e':
      return null;
    default: {
      let text = value.trim();
      if (text === '') return null;
      const number = Number(text);
      const style = styles[Number(cell.getAttribute('s') ?? '0')];
      // a code formatted with zeros keeps the leading zeros Excel shows (an EAN of a US product)
      if (style?.zeroPad && Number.isSafeInteger(number) && number >= 0) {
        text = String(number).padStart(style.zeroPad, '0');
      }
      return textCell(text, Number.isFinite(number) ? number : null, style);
    }
  }
}

/**
 * An .xlsx (spec 2026-10-20-data-import, 3.2): the visible sheets in order, their cells with the values the file
 * stores; a formula gives its stored result; the number format tells a month, a percent, a padded code. Rows keep their
 * numbers, so row i is line i + 1 of the sheet; hidden rows (a filter) are not read.
 */
export async function readXlsx(bytes: Uint8Array): Promise<Workbook> {
  const entries = readZipDirectory(bytes);
  const text = async (name: string): Promise<string | null> => {
    const entry = entries.get(name);
    if (!entry) return null;
    const data = await readZipEntry(bytes, entry, importLimits.unpackedBytes);
    return new TextDecoder('utf-8').decode(data);
  };

  const workbookXml = await text('xl/workbook.xml');
  if (workbookXml === null) throw new SpreadsheetError('unsupported');
  const workbook = parseXml(workbookXml);
  const date1904 = byName(workbook, 'workbookPr').some((element) =>
    ['1', 'true'].includes(element.getAttribute('date1904') ?? ''),
  );

  const relsXml = await text('xl/_rels/workbook.xml.rels');
  if (relsXml === null) throw corrupt();
  const targets = new Map(
    byName(parseXml(relsXml), 'Relationship').map((rel) => [
      rel.getAttribute('Id') ?? '',
      packagePath(rel.getAttribute('Target') ?? ''),
    ]),
  );

  const sharedXml = await text('xl/sharedStrings.xml');
  const shared =
    sharedXml === null
      ? []
      : byName(parseXml(sharedXml), 'si').map((si) => richText(si));
  const styles = cellStyles(await text('xl/styles.xml'));

  const sheets: Workbook['sheets'] = [];
  for (const sheet of byName(workbook, 'sheet')) {
    const state = sheet.getAttribute('state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    const id = relationshipId(sheet);
    const path = id === null ? undefined : targets.get(id);
    const sheetXml = path === undefined ? null : await text(path);
    if (sheetXml === null) throw corrupt();

    const rows: Cell[][] = [];
    let rowIndex = -1;
    let filled = 0;
    let hiddenRows = 0;
    let tooLarge = false;
    for (const row of byName(parseXml(sheetXml), 'row')) {
      const declared = Number(row.getAttribute('r'));
      rowIndex =
        Number.isInteger(declared) && declared > 0
          ? declared - 1
          : rowIndex + 1;
      const cells: Cell[] = [];
      let column = -1;
      for (const cell of childrenByName(row, 'c')) {
        column = columnOf(cell.getAttribute('r')) ?? column + 1;
        const value = readCell(cell, shared, styles);
        if (value !== null) cells[column] = value;
      }
      // a formatted row without values (a range formatted down to row 25 000) is not a row of data
      if (!cells.some((value) => value != null)) continue;
      // a row a filter hides is not loaded: the owner sees only the shown rows (final review, web minor 7)
      if (['1', 'true'].includes(row.getAttribute('hidden') ?? '')) {
        hiddenRows += 1;
        continue;
      }
      filled += 1;
      if (filled > MAX_SHEET_ROWS || rowIndex >= MAX_ROW_INDEX) {
        tooLarge = true;
        break;
      }
      // holes of a sparse row are empty cells
      rows[rowIndex] = Array.from(cells, (value) => value ?? null);
    }
    sheets.push({
      name: sheet.getAttribute('name') ?? '',
      rows: tooLarge ? [] : Array.from(rows, (row) => row ?? []),
      ...(tooLarge ? { tooLarge } : {}),
      ...(hiddenRows > 0 ? { hiddenRows } : {}),
    });
  }
  return { date1904, sheets };
}
