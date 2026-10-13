/*
 * Prescription and buyer data of a ПКУ sale in the buffer of the terminal (ADR-0015, decision of
 * 2026-09-30; spec 2026-10-13-pos-shift-sale, E17): encrypted with AES-GCM by a key that cannot be
 * exported, kept in the IndexedDB of the terminal. A built-in primitive of the browser (Web Crypto),
 * not a cryptography of ours. The data is opened only to be sent to the server.
 */
import type { ControlledSaleData } from '@pharmacy/shared-dto';
import type { PosDb } from './db';

/** Encrypted prescription data: a fresh 12-byte IV per record. */
export interface SealedControlled {
  sealed: true;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const KEY = 'controlled-key';
const keys = new WeakMap<PosDb, Promise<CryptoKey>>();

/**
 * The stored key, or a new one stored in the same transaction that looks for it: two tabs of the
 * terminal never overwrite each other's key (the first stored one wins).
 */
async function loadOrCreate(db: PosDb): Promise<CryptoKey> {
  const stored = (await db.get('state', KEY)) as CryptoKey | undefined;
  if (stored) return stored;
  const created = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const tx = db.transaction('state', 'readwrite');
  const existing = (await tx.store.get(KEY)) as CryptoKey | undefined;
  if (!existing) await tx.store.put(created, KEY);
  await tx.done;
  return existing ?? created;
}

/** The key of the terminal database (a CryptoKey is stored as is, never exported). */
function keyOf(db: PosDb): Promise<CryptoKey> {
  let key = keys.get(db);
  if (!key) {
    key = loadOrCreate(db);
    keys.set(db, key);
    // a failure is not kept: the next sale tries again
    key.catch(() => keys.delete(db));
  }
  return key;
}

export function isSealed(value: unknown): value is SealedControlled {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { sealed?: unknown }).sealed === true
  );
}

export async function sealControlled(
  db: PosDb,
  value: ControlledSaleData,
): Promise<SealedControlled> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyOf(db),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { sealed: true, iv, data };
}

export async function openControlled(
  db: PosDb,
  sealed: SealedControlled,
): Promise<ControlledSaleData> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv },
    await keyOf(db),
    sealed.data,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as ControlledSaleData;
}
