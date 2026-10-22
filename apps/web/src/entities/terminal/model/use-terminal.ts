'use client';

/*
 * The terminal runtime of the working store (IndexedDB + outbox) for components, and the counters
 * of unsent operations that the cashier always sees (ADR-0015). Without a session (the sign-in screen after a
 * reload) the runtime of the bound terminal sends the buffer under the terminal (spec
 * 2026-10-21-pos-offline-limits, P18): the binding comes from the API, offline — the remembered one.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { sessionQueryKey, useSession } from '@/entities/session/@x/terminal';
import {
  getTerminalRuntime,
  type OutboxCounts,
  type TerminalRuntime,
} from '@/shared/lib/offline-queue';
import { rememberedBinding } from '@/shared/lib/terminal-cache';
import { useBoundTerminal } from '../api/bound-terminal';

const EMPTY: OutboxCounts = {
  pending: 0,
  quarantine: 0,
  paused: false,
  oldestPendingAt: null,
  controlledPending: 0,
  oldestControlledAt: null,
};

interface Binding {
  tenantId: string;
  storeId: string;
}

/**
 * The network and store whose buffer this page sends: a PIN session's (its terminal's store); else the bound terminal's —
 * a password session on the till drains the buffer of the till too; offline the remembered binding; a browser that is
 * not bound — the session's store. While the terminal is asked, nothing: a rebound browser must not send the buffer of
 * its old store with the new device-cookie.
 */
function useBinding(): Binding | null {
  const { data: session, isPending } = useSession();
  const fromSession =
    session?.tenant.id && session.currentStoreId
      ? { tenantId: session.tenant.id, storeId: session.currentStoreId }
      : null;
  const onTerminal = Boolean(session?.terminalId);
  const bound = useBoundTerminal({ enabled: !isPending && !onTerminal });
  const fromTerminal = bound.data
    ? { tenantId: bound.data.tenantId, storeId: bound.data.store.id }
    : null;
  const [remembered, setRemembered] = useState<Binding | null>(null);
  const needRemembered = !isPending && !onTerminal && bound.isError;
  useEffect(() => {
    if (!needRemembered) return;
    let cancelled = false;
    void rememberedBinding().then((value) => {
      if (!cancelled) setRemembered(value ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [needRemembered]);
  if (isPending) return null;
  if (onTerminal) return fromSession;
  if (fromTerminal) return fromTerminal;
  if (bound.data === null) return fromSession;
  if (needRemembered) return remembered ?? fromSession;
  return null;
}

export function useTerminalRuntime(): TerminalRuntime | null {
  const { data: session } = useSession();
  const binding = useBinding();
  const tenantId = binding?.tenantId;
  const storeId = binding?.storeId;
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

  // a sign-in (PIN or password) ends the pause of the buffer after a 401/403 (spec 2026-10-13, E18)
  const signedInAt = session?.authenticatedAt;
  useEffect(() => {
    if (runtime && signedInAt) runtime.queue.resume();
  }, [runtime, signedInAt]);

  // a pause of the buffer (401/403) asks whether the session is still there: without it the shell opens the PIN form
  // (security review 2026-10-22, F2, S4); every user of the runtime sees the pause, they share one request
  const queryClient = useQueryClient();
  const paused = useOutboxCounts(runtime).paused;
  useEffect(() => {
    if (paused)
      void queryClient.invalidateQueries(
        { queryKey: sessionQueryKey },
        { cancelRefetch: false },
      );
  }, [paused, queryClient]);

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
