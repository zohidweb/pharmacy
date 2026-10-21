import { importLimits } from '@pharmacy/shared-domain';
import { type Cell, SpreadsheetError, type Workbook, textCell } from './cells';

/** Rows a file may span — data rows plus title rows. */
const MAX_ROWS = importLimits.rows + 100;

/**
 * The text of a CSV (spec 2026-10-20-data-import, 3.3): a BOM decides (UTF-8, or the UTF-16 of «Unicode text» of
 * Excel); otherwise UTF-8 when the bytes are valid UTF-8, else windows-1251 — what a Russian Excel saves.
 */
function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

/** `;`, `,` or a tab — the one the first line has most of outside quotes; `;` on a tie, as Excel in Russian saves. */
function delimiterOf(text: string): string {
  const counts = new Map<string, number>([
    [';', 0],
    [',', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) {
      if ([...counts.values()].some((count) => count > 0)) break;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  let best = ';';
  for (const [char, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = char;
  }
  return best;
}

/** A CSV (3.3): fields by RFC 4180 — `""` inside quotes, line breaks inside quotes, CRLF or LF. */
export function readCsv(bytes: Uint8Array): Workbook {
  const text = decode(bytes);
  const delimiter = delimiterOf(text);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  const endField = () => {
    row.push(textCell(field));
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row.every((cell) => cell === null) ? [] : row);
    row = [];
    if (rows.length > MAX_ROWS) throw new SpreadsheetError('too_many_rows');
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return { date1904: false, sheets: [{ name: '', rows }] };
}
