'use client';

/*
 * The terminal runtime of the working store (IndexedDB + outbox) for components, and the counters
 * of unsent operations that the cashier always sees (ADR-0015).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession } from '@/entities/session/@x/terminal';
import {
  getTerminalRuntime,
  type OutboxCounts,
  type TerminalRuntime,
} from '@/shared/lib/offline-queue';

const EMPTY: OutboxCounts = { pending: 0, quarantine: 0, paused: false };

export function useTerminalRuntime(): TerminalRuntime | null {
  const { data: session } = useSession();
  const tenantId = session?.tenant.id;
  const storeId = session?.currentStoreId;
  const [runtime, setRuntime] = useState<TerminalRuntime | null>(null);

  useEffect(() => {
    if (!tenantId || !storeId) return;
    let cancelled = false;
    getTerminalRuntime(tenantId, storeId).then((value) => {
      if (!cancelled) setRuntime(value);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, storeId]);

  return runtime && storeId && runtime.key.endsWith(`:${storeId}`)
    ? runtime
    : null;
}

export function useOutboxCounts(runtime: TerminalRuntime | null): OutboxCounts {
  return useSyncExternalStore(
    (listener) => runtime?.queue.subscribe(listener) ?? (() => undefined),
    () => runtime?.queue.getCounts() ?? EMPTY,
    () => EMPTY,
  );
}
