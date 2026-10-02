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
  return { activeId, keys };
}
