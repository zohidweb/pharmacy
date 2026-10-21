import { importLimits } from '@pharmacy/shared-domain';
import { type Cell, type Workbook, textCell } from './cells';

/** Rows with data a file may hold — data rows plus title rows; past it the sheet is marked `tooLarge`. */
const MAX_ROWS = importLimits.rows + 100;

/**
 * The text of a CSV (spec 2026-10-20-data-import, 3.3): a BOM decides (UTF-8, or the UTF-16 of «Unicode text» of
 * Excel); otherwise UTF-8 when the bytes are valid UTF-8, else windows-1251 — what a Russian Excel saves.
 */
function decode(bytes: Uint8Array): { text: string; windows: boolean } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      windows: false,
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      windows: false,
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      windows: false,
    };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      windows: false,
    };
  } catch {
    return {
      text: new TextDecoder('windows-1251').decode(bytes),
      windows: true,
    };
  }
}

/**
 * `;`, `,` or a tab — the one the first five lines have most of outside quotes (a narrow file with commas in its
 * headers is still read by `;`, web minor 18); `;` on a tie, as Excel in Russian saves.
 */
function delimiterOf(text: string): string {
  const counts = new Map<string, number>([
    [';', 0],
    [',', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  let lines = 0;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '\n') {
      lines += 1;
      if (lines >= 5) break;
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
  const { text, windows } = decode(bytes);
  const delimiter = delimiterOf(text);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  let filled = 0;
  let tooLarge = false;
  const endField = () => {
    row.push(textCell(field));
    field = '';
  };
  const endRow = () => {
    endField();
    // a row of empty cells (`;;;;`) keeps its line number but is not a row of data (final review W4)
    const empty = row.every((cell) => cell === null);
    if (!empty) filled += 1;
    if (filled > MAX_ROWS) tooLarge = true;
    if (!tooLarge) rows.push(empty ? [] : row);
    row = [];
  };
  for (let i = 0; i < text.length && !tooLarge; i += 1) {
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
  if (!tooLarge && (field !== '' || row.length > 0)) endRow();
  return {
    date1904: false,
    sheets: [tooLarge ? { name: '', rows: [], tooLarge } : { name: '', rows }],
    // a letter windows-1251 has not is saved by Excel as «?» (final review W5)
    ...(windows && /[а-яё]\?|\?[а-яё]/i.test(text)
      ? { lostLetters: true }
      : {}),
  };
}
