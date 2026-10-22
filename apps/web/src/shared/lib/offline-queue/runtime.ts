/*
 * One terminal runtime per tenant and store: the IndexedDB and its outbox sender. Created on first
 * use, kept for the life of the page; the sender wakes up whenever the connection comes back.
 */
import { subscribeConnectivity } from '@/shared/api';
import { openPosDb, posDbName, type PosDb } from './db';
import {
  sendPosOperation,
  type PosOperation,
  type StoredReceiptRequest,
} from './operations';
import { OfflineQueue } from './queue';
import { nextLocalNumber } from './receipt-seq';

export interface TerminalRuntime {
  key: string;
  db: PosDb;
  queue: OfflineQueue;
  /** Enqueues a POS operation; `alsoInTransaction` changes the draft atomically with it. */
  enqueue: (
    operation: PosOperation,
    alsoInTransaction?: Parameters<OfflineQueue['enqueue']>[1],
  ) => Promise<void>;
  /**
   * Enqueues a sale with its local number within the shift, given in the same transaction (spec
   * 2026-10-21-pos-offline-limits, P12); resolves to that number.
   */
  enqueueReceipt: (
    payload: StoredReceiptRequest,
    alsoInTransaction?: Parameters<OfflineQueue['enqueue']>[1],
  ) => Promise<number>;
}

/** A sale with a ПКУ line counts against the ПКУ limit of the buffer (P7). */
const isControlledSale = (operation: PosOperation): boolean =>
  operation.kind === 'receipt' &&
  operation.payload.lines.some((line) => line.controlled !== null);

const runtimes = new Map<string, Promise<TerminalRuntime>>();

async function create(key: string): Promise<TerminalRuntime> {
  const db = await openPosDb(key);
  const queue = new OfflineQueue(
    db,
    `pharmacy-outbox:${key}`,
    // the sender opens the sealed prescription data of a sale with the key of this database
    (record) => sendPosOperation(record, db),
  );
  subscribeConnectivity((online) => {
    if (online) void queue.flush();
  });
  // ask the browser not to evict the buffer under storage pressure (ADR-0015)
  void navigator.storage?.persist?.().catch(() => false);
  await queue.refreshCounts();
  void queue.flush();
  const recordOf = (operation: PosOperation) => ({
    id: operation.payload.id,
    kind: operation.kind,
    payload: operation.payload,
    createdAt: new Date().toISOString(),
    controlled: isControlledSale(operation),
  });
  return {
    key,
    db,
    queue,
    enqueue: (operation, alsoInTransaction) =>
      queue.enqueue(recordOf(operation), alsoInTransaction),
    enqueueReceipt: async (payload, alsoInTransaction) => {
      let localNumber = 0;
      await queue.enqueue(
        recordOf({ kind: 'receipt', payload }),
        alsoInTransaction,
        async (tx, record) => {
          localNumber = await nextLocalNumber(tx, payload.shiftId);
          return { ...record, payload: { ...payload, localNumber } };
        },
      );
      return localNumber;
    },
  };
}

export function getTerminalRuntime(
  tenantId: string,
  storeId: string,
): Promise<TerminalRuntime> {
  const key = posDbName(tenantId, storeId);
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = create(key);
    runtimes.set(key, runtime);
  }
  return runtime;
}

/**
 * Tests only: stop the senders and forget the runtimes. Databases are left open — a component that is
 * still mounted may read them; the test replaces the whole fake IndexedDB factory instead.
 */
export async function resetTerminalRuntimes(): Promise<void> {
  for (const runtime of runtimes.values()) {
    const value = await runtime.catch(() => null);
    value?.queue.stop();
  }
  runtimes.clear();
}
