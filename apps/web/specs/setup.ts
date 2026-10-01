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

expect.extend(toHaveNoViolations);

// IndexedDB writes of the outbox take longer on a loaded machine (parallel nx tasks)
configure({ asyncUtilTimeout: 3_000 });
