import { TextDecoder, TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';
import { configure } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';
import '@pharmacy/ui/testing';
// IndexedDB of the POS terminal (ADR-0015: fake-indexeddb in tests)
import 'fake-indexeddb/auto';

// jsdom hides Node's structuredClone, which fake-indexeddb uses to store values
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T =>
    deserialize(serialize(value));
}

// jsdom has no TextEncoder; lean-qr (the QR of a receipt, ADR-0022) makes one when it loads
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

expect.extend(toHaveNoViolations);

// IndexedDB writes of the outbox take longer on a loaded machine (parallel nx tasks)
configure({ asyncUtilTimeout: 5_000 });

// a page that forgot a dictionary group renders key paths: fail the test instead (ADR-0009)
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const text = args.map((arg) => String(arg)).join(' ');
  if (text.includes('MISSING_MESSAGE')) throw new Error(text);
  consoleError(...args);
};
