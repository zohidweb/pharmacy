/**
 * Restricted Markdown of the public site (spec 2026-10-28-public-site-design, 6.6; ADR-0023).
 *
 * Article and document texts are stored as Markdown and parsed into a tree of blocks. The API uses the
 * tree to validate a text and to find `media:` references; the site and the admin preview render the tree
 * into React elements (never into an HTML string). Anything the parser does not know — raw HTML included —
 * stays plain text.
 *
 * Supported: headings `##` and `###`; paragraphs; `**bold**`, `*italic*`, `[text](href)`; unordered and
 * ordered lists (no nesting); quotes; pipe tables; images `![caption](media:<uuid>)` on a line of their own.
 *
 * Tables: a header row, then a separator row of exactly as many cells as the header, each cell of at least
 * three dashes (`---`, `:---`, `---:`, `:---:`); at most 20 columns. Anything else stays text.
 * No backslash escapes: a backslash is text as written and `\|` still ends a cell, so a cell cannot hold `|`.
 *
 * The parser never throws and has no nested quantifiers or backtracking: the time is linear in the length
 * of the text (a text is limited to 100 000 characters by the API).
 */

export type SiteInline =
  | { kind: 'text'; text: string; bold?: true; italic?: true }
  | { kind: 'link'; href: string; children: SiteInline[] };

export type SiteBlock =
  | { kind: 'heading'; level: 2 | 3; children: SiteInline[] }
  | { kind: 'paragraph'; children: SiteInline[] }
  | { kind: 'list'; ordered: boolean; items: SiteInline[][] }
  | { kind: 'quote'; children: SiteInline[] }
  | { kind: 'table'; header: SiteInline[][]; rows: SiteInline[][][] }
  | { kind: 'image'; mediaId: string; caption: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_LINE = /^!\[([^\]]*)\]\(media:([^()\s]+)\)$/;
const UNORDERED_ITEM = /^[-*]\s+(\S.*)$/;
const ORDERED_ITEM = /^\d+\.\s+(\S.*)$/;
const SEPARATOR_CELL = /^:?-{3,}:?$/;
const MAX_TABLE_COLUMNS = 20;

/**
 * Whether a link target may be rendered as a link: `https:`, `http:`, `mailto:` or a path from the site
 * root (`/…`, but not `//…` or `/\…`). Everything else — `javascript:`, `data:`, relative paths without a
 * leading slash, anchors — is not safe. Whitespace and control characters are never allowed.
 */
export function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (value === '' || /\s/.test(value) || hasControlChars(value)) return false;
  if (value.startsWith('/')) {
    return value.length === 1 || (value[1] !== '/' && value[1] !== '\\');
  }
  const lower = value.toLowerCase();
  if (lower.startsWith('https://')) return lower.length > 'https://'.length;
  if (lower.startsWith('http://')) return lower.length > 'http://'.length;
  if (lower.startsWith('mailto:')) return lower.length > 'mailto:'.length;
  return false;
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Identifiers (lower-case, without repeats, in order of appearance) of the images of a parsed text. */
export function siteMarkdownMediaIds(blocks: SiteBlock[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.kind === 'image') seen.add(block.mediaId);
  }
  return [...seen];
}

/** Parses the restricted Markdown into blocks. Never throws; unknown syntax stays text. */
export function parseSiteMarkdown(source: string): SiteBlock[] {
  // not a string (a stored null, a bad caller) is an empty text: the parser never throws
  const text = typeof source === 'string' ? source : '';
  try {
    return parseBlocks(text);
  } catch {
    // Defensive: the parser has no known failing input; a broken text must not break a page.
    return text.trim() === ''
      ? []
      : [{ kind: 'paragraph', children: [{ kind: 'text', text }] }];
  }
}

// ---------------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------------

function parseBlocks(source: string): SiteBlock[] {
  const lines = source.split(/\r\n|\r|\n/).map((line) => line.trim());
  const blocks: SiteBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === '') {
      i += 1;
      continue;
    }

    const image = parseImage(line);
    if (image) {
      blocks.push(image);
      i += 1;
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      blocks.push(heading);
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitCells(line).map((cell) => parseInline(cell));
      const rows: SiteInline[][][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(normalizeRow(splitCells(lines[i]), header.length));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = unordered ? null : ORDERED_ITEM.exec(line);
    if (unordered || ordered) {
      const isOrdered = !unordered;
      const pattern = isOrdered ? ORDERED_ITEM : UNORDERED_ITEM;
      const items: SiteInline[][] = [];
      while (i < lines.length) {
        const match = pattern.exec(lines[i]);
        if (!match) break;
        items.push(parseInline(match[1]));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    if (isQuoteLine(line)) {
      const parts: string[] = [];
      while (i < lines.length && isQuoteLine(lines[i])) {
        parts.push(lines[i].slice(2).trim());
        i += 1;
      }
      blocks.push({ kind: 'quote', children: parseInline(parts.join(' ')) });
      continue;
    }

    // A paragraph: the first line is always taken, the following ones until a blank line or a block start.
    const parts: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i] !== '' && !startsBlock(lines, i)) {
      parts.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(parts.join(' ')) });
  }

  return blocks;
}

function parseImage(line: string): SiteBlock | null {
  const match = IMAGE_LINE.exec(line);
  if (!match || !UUID.test(match[2])) return null;
  return {
    kind: 'image',
    mediaId: match[2].toLowerCase(),
    caption: match[1].trim(),
  };
}

function parseHeading(line: string): SiteBlock | null {
  let level: 2 | 3;
  let rest: string;
  if (line.startsWith('### ')) {
    level = 3;
    rest = line.slice(4);
  } else if (line.startsWith('## ')) {
    level = 2;
    rest = line.slice(3);
  } else {
    return null;
  }
  rest = rest.trim();
  if (rest === '') return null;
  return { kind: 'heading', level, children: parseInline(rest) };
}

function isQuoteLine(line: string): boolean {
  return line.startsWith('> ') && line.slice(2).trim() !== '';
}

function isTableRow(line: string): boolean {
  return line.length >= 2 && line.startsWith('|') && line.endsWith('|');
}

function splitCells(line: string): string[] {
  return line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparatorCells(cells: string[]): boolean {
  return cells.every((cell) => SEPARATOR_CELL.test(cell));
}

/**
 * A table starts with a header row of at most MAX_TABLE_COLUMNS cells followed by a separator row of exactly
 * the same number of cells. Bounding the width keeps the padding of body rows linear in the text.
 */
function isTableStart(lines: string[], index: number): boolean {
  if (!isTableRow(lines[index]) || index + 1 >= lines.length) return false;
  if (!isTableRow(lines[index + 1])) return false;
  const header = splitCells(lines[index]);
  if (header.length > MAX_TABLE_COLUMNS) return false;
  const separator = splitCells(lines[index + 1]);
  return separator.length === header.length && isSeparatorCells(separator);
}

function normalizeRow(cells: string[], width: number): SiteInline[][] {
  const row: SiteInline[][] = [];
  for (let c = 0; c < width; c += 1) {
    row.push(c < cells.length ? parseInline(cells[c]) : []);
  }
  return row;
}

/** Whether the line at `index` begins a block (and so interrupts a paragraph). */
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    parseImage(line) !== null ||
    parseHeading(line) !== null ||
    isQuoteLine(line) ||
    UNORDERED_ITEM.test(line) ||
    ORDERED_ITEM.test(line) ||
    isTableStart(lines, index)
  );
}

// ---------------------------------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------------------------------

type Token =
  | { type: 'text'; text: string }
  | { type: 'link'; raw: string; href: string; label: string }
  | {
      type: 'delim';
      size: 1 | 2;
      left: boolean;
      right: boolean;
      active: boolean;
    };

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Parses `**bold**`, `*italic*` and `[text](href)`. Bold and italic may stand inside a link text, links
 * never nest. An unclosed marker and a link with an unsafe target stay text.
 */
function parseInline(text: string): SiteInline[] {
  return renderTokens(pairDelimiters(tokenize(text)));
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let literalStart = 0;
  let i = 0;

  const flush = (end: number) => {
    if (end > literalStart) {
      tokens.push({ type: 'text', text: text.slice(literalStart, end) });
    }
  };

  while (i < text.length) {
    const char = text[i];

    if (char === '*') {
      flush(i);
      let end = i;
      while (end < text.length && text[end] === '*') end += 1;
      const run = end - i;
      const tokenCount = Math.ceil(run / 2);
      const before = text[i - 1];
      const after = text[end];
      for (let k = 0; k < tokenCount; k += 1) {
        tokens.push({
          type: 'delim',
          size: k === tokenCount - 1 && run % 2 === 1 ? 1 : 2,
          left: k < tokenCount - 1 || !isSpace(after),
          right: k > 0 || !isSpace(before),
          active: false,
        });
      }
      i = end;
      literalStart = end;
      continue;
    }

    if (char === '[') {
      const link = scanLink(text, i);
      if (link) {
        flush(i);
        tokens.push(link.token);
        i = link.end;
        literalStart = i;
        continue;
      }
    }

    i += 1;
  }
  flush(text.length);
  return tokens;
}

/**
 * `[label](href)` starting at `start`. The label stops at the first `]` and may not contain `[`; the target
 * may hold balanced parentheses but no whitespace, `[` or `]`. Each scan stops at a character the next scan
 * would start from, so the whole pass stays linear.
 */
function scanLink(
  text: string,
  start: number,
): { token: Token; end: number } | null {
  let i = start + 1;
  while (i < text.length && text[i] !== ']' && text[i] !== '[') i += 1;
  if (i >= text.length || text[i] !== ']' || i === start + 1) return null;
  const label = text.slice(start + 1, i);
  if (text[i + 1] !== '(') return null;

  const hrefStart = i + 2;
  let depth = 0;
  let j = hrefStart;
  for (; j < text.length; j += 1) {
    const char = text[j];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === '[' || char === ']' || /\s/.test(char)) {
      return null;
    }
  }
  if (j >= text.length || j === hrefStart) return null;

  const href = text.slice(hrefStart, j);
  const raw = text.slice(start, j + 1);
  return { token: { type: 'link', raw, href, label }, end: j + 1 };
}

/** Pairs opening and closing markers; markers left without a pair stay text. */
function pairDelimiters(tokens: Token[]): Token[] {
  let openBold = -1;
  let openItalic = -1;

  tokens.forEach((token, index) => {
    if (token.type !== 'delim') return;
    let open = token.size === 2 ? openBold : openItalic;

    // Markers with nothing between them (`****`) are text, and do not pair with a later marker.
    if (open >= 0 && token.right && index === open + 1) {
      open = -1;
      if (token.size === 2) openBold = -1;
      else openItalic = -1;
    }

    if (open >= 0 && token.right && index > open + 1) {
      (tokens[open] as Extract<Token, { type: 'delim' }>).active = true;
      token.active = true;
      if (token.size === 2) openBold = -1;
      else openItalic = -1;
    } else if (token.left) {
      if (token.size === 2) openBold = index;
      else openItalic = index;
    }
  });
  return tokens;
}

function pushText(
  out: SiteInline[],
  text: string,
  bold: boolean,
  italic: boolean,
): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (
    last &&
    last.kind === 'text' &&
    (last.bold === true) === bold &&
    (last.italic === true) === italic
  ) {
    last.text += text;
    return;
  }
  const node: SiteInline = { kind: 'text', text };
  if (bold) node.bold = true;
  if (italic) node.italic = true;
  out.push(node);
}

function renderTokens(tokens: Token[]): SiteInline[] {
  const out: SiteInline[] = [];
  let bold = false;
  let italic = false;

  for (const token of tokens) {
    if (token.type === 'text') {
      pushText(out, token.text, bold, italic);
    } else if (token.type === 'delim') {
      if (token.active) {
        if (token.size === 2) bold = !bold;
        else italic = !italic;
      } else {
        pushText(out, token.size === 2 ? '**' : '*', bold, italic);
      }
    } else if (!isSafeHref(token.href)) {
      pushText(out, token.raw, bold, italic);
    } else {
      // The label has no `[`, so it holds no links: this recursion goes one level deep at most.
      const children = parseInline(token.label).map((child) =>
        child.kind === 'text' ? withFormat(child, bold, italic) : child,
      );
      out.push({ kind: 'link', href: token.href.trim(), children });
    }
  }
  return out;
}

function withFormat(
  node: Extract<SiteInline, { kind: 'text' }>,
  bold: boolean,
  italic: boolean,
): SiteInline {
  const next: Extract<SiteInline, { kind: 'text' }> = {
    kind: 'text',
    text: node.text,
  };
  if (bold || node.bold) next.bold = true;
  if (italic || node.italic) next.italic = true;
  return next;
}
