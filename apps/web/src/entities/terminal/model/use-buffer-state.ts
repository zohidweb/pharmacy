'use client';

/*
 * The state of the limits of the outage buffer for the POS screens (spec 2026-10-21-pos-offline-limits, P6–P8,
 * P17): the counters of the buffer, the limits of the last catalog snapshot and the PIN sign-in of the cashier,
 * recomputed every minute — the age of the buffer grows without any new operation.
 */
import { useEffect, useState } from 'react';
import { useSession } from '@/entities/session/@x/terminal';
import {
  bufferState,
  readBufferLimits,
  type BufferState,
  type TerminalRuntime,
} from '@/shared/lib/offline-queue';
import { posBufferDefaults } from '@pharmacy/shared-domain';
import { useOutboxCounts } from './use-terminal';

const TICK_MS = 60_000;

export function useBufferState(
  runtime: TerminalRuntime | null,
): BufferState | null {
  const { data: session } = useSession();
  const counts = useOutboxCounts(runtime);
  const [limits, setLimits] = useState(posBufferDefaults);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    const refresh = () => {
      setNow(Date.now());
      void readBufferLimits(runtime.db).then((value) => {
        if (!cancelled) setLimits(value);
      });
    };
    refresh();
    const timer = setInterval(refresh, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runtime]);

  if (!runtime) return null;
  // the age of the sign-in matters for a PIN session of the terminal only: it cannot be renewed offline (P17)
  const signedInAt =
    session?.terminalId && session.authenticatedAt
      ? session.authenticatedAt
      : null;
  return bufferState(counts, limits, now, signedInAt);
}
