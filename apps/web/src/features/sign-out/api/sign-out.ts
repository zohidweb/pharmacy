import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { sessionQueryKey } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';

/** DELETE /sessions/current; drops all cached data of the employee and opens the sign-in. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => apiRequest('sessions.delete'),
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
      });
      queryClient.setQueryData(sessionQueryKey, null);
      router.replace(routes.login());
    },
  });
}
