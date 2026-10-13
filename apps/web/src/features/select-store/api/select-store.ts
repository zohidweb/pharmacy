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
    // A session refetch still in flight (the first store has just been created) would answer
    // without the working store and overwrite the one this request sets: cancelled before the
    // request and again before its answer is written (one may have started meanwhile).
    onMutate: () => queryClient.cancelQueries({ queryKey: sessionQueryKey }),
    onSuccess: async (session: EmployeeSession) => {
      await queryClient.cancelQueries({ queryKey: sessionQueryKey });
      queryClient.setQueryData(sessionQueryKey, session);
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
      });
    },
  });
}
