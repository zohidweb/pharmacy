import type { EmployeeSession } from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionQueryKey } from '@/entities/session';
import { apiRequest } from '@/shared/api';

/**
 * PUT /sessions/current/store — the working store (ADR-0018, п. 3). Everything cached belongs to
 * the previous store, so the cache is dropped and refetched for the new one.
 */
export function useSelectStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storeId: string) =>
      apiRequest('sessions.selectStore', { body: { storeId } }),
    onSuccess: (session: EmployeeSession) => {
      queryClient.setQueryData(sessionQueryKey, session);
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
      });
    },
  });
}
