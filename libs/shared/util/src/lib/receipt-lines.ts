/**
 * Fixed-width lines of a printed receipt (skill ui-standards-tokens, «Печать чеков»): built in TS so
 * the on-screen preview and the paper are identical. One character = one column after NFC
 * normalization (Tajik letters are precomposed). Lengths always come from `cols`.
 */
export type ReceiptLine = string;

const nfc = (text: string) => text.normalize('NFC');

/** Wraps text into lines of at most `cols` characters, breaking on spaces where possible. */
export function receiptWrap(text: string, cols: number): ReceiptLine[] {
  const words = nfc(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > cols) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += cols)
        lines.push(word.slice(i, i + cols));
      current = lines.pop() ?? '';
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > cols) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** Left text and a right-aligned value; long left text wraps and the value gets its own line. */
export function receiptRow(
  left: string,
  right: string,
  cols: number,
): ReceiptLine[] {
  const l = nfc(left);
  const r = nfc(right);
  if (l.length + 1 + r.length <= cols) {
    return [l + ' '.repeat(cols - l.length - r.length) + r];
  }
  return [...receiptWrap(l, cols), r.padStart(cols)];
}

export function receiptCenter(text: string, cols: number): ReceiptLine[] {
  return receiptWrap(text, cols).map((line) => {
    const pad = Math.floor((cols - line.length) / 2);
    return ' '.repeat(pad) + line;
  });
}

export function receiptRule(cols: number, char = '-'): ReceiptLine {
  return char.repeat(cols);
}
