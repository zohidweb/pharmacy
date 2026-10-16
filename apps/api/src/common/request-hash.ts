import { createHash } from 'node:crypto';

/** JSON with the keys of every object sorted and undefined values left out. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The hash of a request kept with an operation whose client id is the idempotency key (spec
 * 2026-10-15-billing-services, A9, B17): a repeat with the same body hashes the same. SHA-256 of
 * node:crypto over the canonical JSON — the rule of the POS buffer (pos/idempotency.ts).
 */
export function requestHash(body: unknown): Buffer {
  return createHash('sha256').update(canonical(body)).digest();
}
