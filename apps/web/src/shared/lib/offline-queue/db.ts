/*
 * IndexedDB of a POS terminal (ADR-0015, ось 6а): one database per tenant and store, so the buffer of
 * one store can never be sent on behalf of another. Access goes only through this module (idb).
 */
import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb';

export type OutboxStatus = 'pending' | 'quarantine';

export interface OutboxError {
  status: number;
  code: string;
  correlationId: string;
}

export interface OutboxRecord<Kind extends string = string, Payload = unknown> {
  /** UUIDv7 of the operation — also the Idempotency-Key; never regenerated. */
  id: string;
  kind: Kind;
  payload: Payload;
  /** ISO instant; FIFO order. */
  createdAt: string;
  attempts: number;
  status: OutboxStatus;
  /** Epoch ms before which the operation is not resent (backoff). */
  nextAttemptAt: number;
  lastError: OutboxError | null;
}

interface PosDbSchema extends DBSchema {
  outbox: {
    key: string;
    value: OutboxRecord;
    indexes: { byCreatedAt: string };
  };
  /** Draft receipt and other terminal state that must survive F5. */
  state: { key: string; value: unknown };
  /** Catalog snapshot of the store (ADR-0015: scan and search work during an outage). */
  catalog: { key: string; value: unknown };
}

export type PosDb = IDBPDatabase<PosDbSchema>;

/** The transaction an operation is enqueued in, together with changes of the terminal state. */
export type PosWriteTransaction = IDBPTransaction<
  PosDbSchema,
  ['outbox', 'state'],
  'readwrite'
>;

const VERSION = 1;

export function posDbName(tenantId: string, storeId: string): string {
  return `pharmacy-pos:${tenantId}:${storeId}`;
}

export function openPosDb(name: string): Promise<PosDb> {
  return openDB<PosDbSchema>(name, VERSION, {
    upgrade(db) {
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('byCreatedAt', 'createdAt');
      db.createObjectStore('state');
      db.createObjectStore('catalog');
    },
  });
}
