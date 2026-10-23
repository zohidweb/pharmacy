import type { QueryClient } from '@tanstack/react-query';
import { sessionQueryKey } from './session-queries';

/**
 * Ends the operator session in the browser (security review 2026-10-22, F2, F6): every cached query is dropped — the
 * tenants, invoices and journals of this operator must not show to the next one on the same tab — and the session
 * becomes null, so the shell opens the sign-in.
 */
export function resetSession(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
  });
  queryClient.setQueryData(sessionQueryKey, null);
}
