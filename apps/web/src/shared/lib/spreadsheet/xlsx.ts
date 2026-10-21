import { importLimits } from '@pharmacy/shared-domain';
import { type Cell, SpreadsheetError, type Workbook, textCell } from './cells';
import { readZipDirectory, readZipEntry } from './zip';

/** Rows a sheet may span — data rows plus title rows; a sheet past it is not read further. */
const MAX_SHEET_ROWS = importLimits.rows + 100;

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

function readCell(cell: Element, shared: readonly string[]): Cell {
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
      const text = value.trim();
      if (text === '') return null;
      const number = Number(text);
      return textCell(text, Number.isFinite(number) ? number : null);
    }
  }
}

/**
 * An .xlsx (spec 2026-10-20-data-import, 3.2): the visible sheets in order, their cells with the values the file
 * stores; a formula gives its stored result. Rows keep their numbers, so row i is line i + 1 of the sheet.
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
    for (const row of byName(parseXml(sheetXml), 'row')) {
      const declared = Number(row.getAttribute('r'));
      rowIndex =
        Number.isInteger(declared) && declared > 0
          ? declared - 1
          : rowIndex + 1;
      if (rowIndex >= MAX_SHEET_ROWS)
        throw new SpreadsheetError('too_many_rows');
      const cells: Cell[] = [];
      let column = -1;
      for (const cell of childrenByName(row, 'c')) {
        column = columnOf(cell.getAttribute('r')) ?? column + 1;
        const value = readCell(cell, shared);
        if (value !== null) cells[column] = value;
      }
      // holes of a sparse row are empty cells
      rows[rowIndex] = Array.from(cells, (value) => value ?? null);
    }
    sheets.push({
      name: sheet.getAttribute('name') ?? '',
      rows: Array.from(rows, (row) => row ?? []),
    });
  }
  return { date1904, sheets };
}
