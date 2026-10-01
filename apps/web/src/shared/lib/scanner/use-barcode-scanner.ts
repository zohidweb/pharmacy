'use client';

/*
 * Barcode scanner in keyboard mode (USB HID, ADR-0015 ось 7): a fast burst of keys ending with Enter.
 * The buffer reads `event.code` (Digit0…, KeyA…), not `event.key` — under a Russian or Tajik layout
 * the scanner would type Cyrillic instead of Code128 Latin. No setState per character: the buffer
 * lives in a ref. A burst typed into the search field is taken back out of the field.
 */
import { useEffect, useRef } from 'react';

export interface ScannerOptions {
  /** Longest pause between two characters of one scan, ms (a terminal setting). */
  maxIntervalMs?: number;
  /** Shortest code accepted as a scan. */
  minLength?: number;
  enabled?: boolean;
}

const DIGIT = /^(?:Digit|Numpad)(\d)$/;
const LETTER = /^Key([A-Z])$/;
const SYMBOLS: Record<string, string> = {
  Minus: '-',
  NumpadSubtract: '-',
  Period: '.',
  NumpadDecimal: '.',
  Slash: '/',
  NumpadDivide: '/',
  Space: ' ',
};

/** Latin character of a physical key, independent of the keyboard layout. */
export function charOfCode(code: string, shift: boolean): string | null {
  const digit = DIGIT.exec(code);
  if (digit) return digit[1];
  const letter = LETTER.exec(code);
  if (letter) return shift ? letter[1] : letter[1].toLowerCase();
  return SYMBOLS[code] ?? null;
}

interface Burst {
  code: string;
  lastAt: number;
  /** The text field the burst was typed into and its value before the burst. */
  field: HTMLInputElement | null;
  fieldValue: string;
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useBarcodeScanner(
  onScan: (code: string) => void,
  { maxIntervalMs = 35, minLength = 6, enabled = true }: ScannerOptions = {},
): void {
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let burst: Burst | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      const now = performance.now();
      if (event.ctrlKey || event.altKey || event.metaKey) {
        burst = null;
        return;
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        const done = burst;
        burst = null;
        if (
          !done ||
          done.code.length < minLength ||
          now - done.lastAt > maxIntervalMs * 3
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (done.field) setNativeValue(done.field, done.fieldValue);
        performance.mark?.('pos:scan');
        handler.current(done.code);
        return;
      }
      const char = charOfCode(event.code, event.shiftKey);
      if (char === null) {
        burst = null;
        return;
      }
      const target = event.target;
      const field =
        target instanceof HTMLInputElement && target.type !== 'password'
          ? target
          : null;
      if (!burst || now - burst.lastAt > maxIntervalMs) {
        burst = {
          code: '',
          lastAt: now,
          field,
          fieldValue: field?.value ?? '',
        };
      }
      burst.code += char;
      burst.lastAt = now;
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled, maxIntervalMs, minLength]);
}
