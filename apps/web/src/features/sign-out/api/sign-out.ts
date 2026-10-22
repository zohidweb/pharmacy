import type { EmployeeSession } from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  markSignOutPending,
  resetSession,
  sessionQueryKey,
} from '@/entities/session';
import { apiRequest, isUnreachable } from '@/shared/api';
import { routes } from '@/shared/config';

/**
 * DELETE /sessions/current; drops all cached data of the employee and opens the sign-in. When the server cannot be
 * reached the terminal is locked all the same, and the sign-out goes when the connection is back (security review
 * 2026-10-22, F3, S5); any other error is shown, as before.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const signOutHere = () => {
    resetSession(queryClient);
    router.replace(routes.login());
  };
  return useMutation({
    mutationFn: () => apiRequest('sessions.delete'),
    onSuccess: signOutHere,
    onError: (error) => {
      if (!isUnreachable(error)) return;
      const session = queryClient.getQueryData<EmployeeSession | null>(
        sessionQueryKey,
      );
      if (session) markSignOutPending(session.authenticatedAt);
      signOutHere();
    },
  });
}
