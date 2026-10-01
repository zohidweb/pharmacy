import type { EmployeeSession } from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionQueryKey } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { setLocale } from '@/shared/i18n';
import type { LoginPayload } from '../model/login-schema';

/** POST /sessions; the session query is primed and the employee's language applied. */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginPayload) =>
      apiRequest('sessions.create', { body: payload }),
    onSuccess: (session: EmployeeSession) => {
      queryClient.setQueryData(sessionQueryKey, session);
      setLocale(session.locale);
    },
  });
}
