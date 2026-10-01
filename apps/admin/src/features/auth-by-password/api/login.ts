import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionQueryKey } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import type { LoginPayload } from '../model/login-schema';

/** POST /operator/sessions; on success the session query is primed without a refetch. */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginPayload) =>
      apiRequest('operator.sessions.create', { body: payload }),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionQueryKey, session);
    },
  });
}
