'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest } from '@/shared/api';
import { forgetBinding, rememberBinding } from '@/shared/lib/terminal-cache';

export const terminalQueryKey = ['terminal', 'current'] as const;

/**
 * The terminal of this browser (device-cookie, ADR-0008); null when the browser is not bound. The binding (network
 * and store) is remembered so that the buffer is sent without a session after a reload, offline too (spec
 * 2026-10-21-pos-offline-limits, P18); only a 404 `not_bound` forgets it. Asked during an outage too, like the session:
 * the sign-in shows its form with the binding unknown rather than a paused query's spinner; a binding not read is asked
 * again when the connection is back (`refetchOnReconnect` of the app, a query without data is stale).
 */
export function useBoundTerminal(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: terminalQueryKey,
    queryFn: async ({ signal }) => {
      try {
        const terminal = await apiRequest('terminals.current', { signal });
        void rememberBinding({
          tenantId: terminal.tenantId,
          storeId: terminal.store.id,
        });
        return terminal;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          void forgetBinding();
          return null;
        }
        throw error;
      }
    },
    retry: false,
    networkMode: 'always',
    enabled: options.enabled ?? true,
  });
}
