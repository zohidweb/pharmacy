import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { markSignOutPending, resetSession } from '@/entities/session';
import { ApiError, apiRequest, isUnreachable } from '@/shared/api';
import { routes } from '@/shared/config';

/** A sign-out the server does not answer in time locks the terminal here and goes later. */
const SIGN_OUT_TIMEOUT_MS = 3_000;

/**
 * DELETE /sessions/current; drops all cached data of the employee and opens the sign-in. The request goes even when the
 * POS already shows «Нет связи» (an outage is when the cashier leaves). When it does not end the session — unreachable,
 * no answer in time, or a server error (the reverse proxy answers 5xx while the API restarts) — the terminal is locked
 * all the same and the sign-out goes when the server answers (security review 2026-10-22, F3, S5); a refusal (4xx) is
 * shown, as before.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const signOutHere = () => {
    resetSession(queryClient);
    router.replace(routes.login());
  };
  return useMutation({
    mutationFn: () =>
      apiRequest('sessions.delete', { timeoutMs: SIGN_OUT_TIMEOUT_MS }),
    networkMode: 'always',
    onSuccess: signOutHere,
    onError: (error) => {
      if (
        !isUnreachable(error) &&
        !(error instanceof ApiError && error.status >= 500)
      )
        return;
      markSignOutPending();
      signOutHere();
    },
  });
}
