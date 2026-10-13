import { createHash, hkdfSync } from 'node:crypto';
import { inspect } from 'node:util';

// Versioned secret keys from the environment (JWT signing keys, password peppers; ADR-0008).
// Format: `id:base64url,id:base64url`; the active id signs/hashes new data, the others stay for
// verification, which makes rotation possible without logging everyone out.
//
// Error messages name the variable but never contain key material or raw list entries.

export const MIN_KEY_BYTES = 32;

export interface KeyRing {
  readonly activeId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[A-Za-z0-9._-]+$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function parseKeyRing(
  list: string,
  activeId: string,
  name: string,
): KeyRing {
  const entries = list
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error(`${name} must contain at least one "id:base64url" key`);
  }

  const keys = new Map<string, Buffer>();
  entries.forEach((entry, index) => {
    const parts = entry.split(':');
    const [id, encoded] = parts;
    if (parts.length !== 2 || !KEY_ID.test(id) || !BASE64URL.test(encoded)) {
      throw new Error(
        `${name} entry ${index + 1} must have the form "id:base64url"`,
      );
    }
    if (keys.has(id)) {
      throw new Error(
        `${name} contains a duplicate key id (entry ${index + 1})`,
      );
    }
    const key = Buffer.from(encoded, 'base64url');
    if (key.length < MIN_KEY_BYTES) {
      throw new Error(
        `${name} entry ${index + 1} must decode to at least ${MIN_KEY_BYTES} bytes`,
      );
    }
    keys.set(id, key);
  });

  if (!keys.has(activeId)) {
    throw new Error(`${name}: the active key id is not present in the list`);
  }
  return redacted({ activeId, keys });
}

// SHA-256 of the key material of the public development keys in .env.example (the keys themselves
// are not repeated here). A deployment that copied that file must not run on them.
const PUBLIC_DEVELOPMENT_KEYS = new Set([
  'f4a93ffde842c2c2be34f26a6064e95c5770a69e11d3f540ab155be35af6680b', // SESSION_JWT_KEYS
  '163f791e6e5d7ece06a1d3f0e584c0ddb67bd0ca587569d23a4d03c3596cdcdb', // PASSWORD_PEPPERS
]);

/**
 * A key for one purpose derived from the active key of the ring (HKDF-SHA-256), so that key is not
 * used for anything else directly. It changes when the active key does.
 */
export function deriveRingKey(ring: KeyRing, purpose: string): Buffer {
  const key = ring.keys.get(ring.activeId);
  if (key === undefined) throw new Error('The active key is not present');
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), purpose, 32));
}

/** True when the ring holds a public development key of .env.example. */
export function holdsPublicDevelopmentKey(ring: KeyRing): boolean {
  return [...ring.keys.values()].some((key) =>
    PUBLIC_DEVELOPMENT_KEYS.has(createHash('sha256').update(key).digest('hex')),
  );
}

// A config object logged or inspected by mistake shows the key ids only, never key material.
function redacted(ring: KeyRing): KeyRing {
  const shown = () =>
    `KeyRing(active ${ring.activeId}, ${ring.keys.size} keys, redacted)`;
  for (const target of [ring, ring.keys]) {
    Object.defineProperty(target, 'toJSON', { value: shown });
    Object.defineProperty(target, inspect.custom, { value: shown });
  }
  return ring;
}
