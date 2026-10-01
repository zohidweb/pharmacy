/*
 * One terminal runtime per tenant and store: the IndexedDB and its outbox sender. Created on first
 * use, kept for the life of the page; the sender wakes up whenever the connection comes back.
 */
import { subscribeConnectivity } from '@/shared/api';
import { openPosDb, posDbName, type PosDb } from './db';
import { sendPosOperation, type PosOperation } from './operations';
import { OfflineQueue } from './queue';

export interface TerminalRuntime {
  key: string;
  db: PosDb;
  queue: OfflineQueue;
  /** Enqueues a POS operation; `alsoInTransaction` changes the draft atomically with it. */
  enqueue: (
    operation: PosOperation,
    alsoInTransaction?: Parameters<OfflineQueue['enqueue']>[1],
  ) => Promise<void>;
}

const runtimes = new Map<string, Promise<TerminalRuntime>>();

async function create(key: string): Promise<TerminalRuntime> {
  const db = await openPosDb(key);
  const queue = new OfflineQueue(
    db,
    `pharmacy-outbox:${key}`,
    sendPosOperation,
  );
  subscribeConnectivity((online) => {
    if (online) void queue.flush();
  });
  // ask the browser not to evict the buffer under storage pressure (ADR-0015)
  void navigator.storage?.persist?.().catch(() => false);
  await queue.refreshCounts();
  void queue.flush();
  return {
    key,
    db,
    queue,
    enqueue: (operation, alsoInTransaction) =>
      queue.enqueue(
        {
          id: operation.payload.id,
          kind: operation.kind,
          payload: operation.payload,
          createdAt: new Date().toISOString(),
        },
        alsoInTransaction,
      ),
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
