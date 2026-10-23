import type { QueryClient } from '@tanstack/react-query';
import { freshAuthStore } from '@/shared/api';
import { forgetTerminal } from '@/shared/lib/terminal-cache';
import { sessionQueryKey } from './session-queries';

/**
 * Ends the session in the browser (security review 2026-10-22, F2): the remembered session of the terminal is
 * forgotten, every cached query of the employee is dropped and the session becomes null — the shell then opens the
 * sign-in (the PIN form on a bound terminal). A password confirmation still open belonged to that session: it is
 * cancelled, not left over the sign-in. The POS buffer in IndexedDB stays: its operations belong to the terminal and
 * go after the next sign-in.
 */
export function resetSession(queryClient: QueryClient): void {
  void forgetTerminal();
  if (freshAuthStore.isPending()) freshAuthStore.cancelled();
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
  });
  queryClient.setQueryData(sessionQueryKey, null);
}
