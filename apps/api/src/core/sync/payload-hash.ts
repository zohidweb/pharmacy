import { createHash } from 'node:crypto';

// Canonical JSON of a sync payload (ADR-0014 §2; spec 2026-10-16-offline-sync, E14): object keys sorted
// recursively, no spaces, so the store and the cloud hash the same bytes whatever order the keys were
// written in. Only JSON values are allowed; a number must be finite (money is integer dirams).
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new RangeError('A sync payload holds a non-finite number');
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
        .join(',')}}`;
    }
    default:
      throw new TypeError(`A sync payload holds a ${typeof value} value`);
  }
}

/** SHA-256 hex of the canonical JSON of a payload — `SyncOperation.payloadHash`. */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}
