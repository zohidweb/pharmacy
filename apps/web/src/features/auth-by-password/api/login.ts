import type { EmployeeSession } from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signIn } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { setLocale } from '@/shared/i18n';
import type { LoginPayload } from '../model/login-schema';

/**
 * POST /sessions; the session query is primed and the employee's language applied. Goes during an outage too and fails
 * with «Нет связи»: a sign-in never waits for the connection to sign in later.
 */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginPayload) =>
      signIn(queryClient, () =>
        apiRequest('sessions.create', { body: payload }),
      ),
    networkMode: 'always',
    onSuccess: (session: EmployeeSession) => {
      setLocale(session.locale);
    },
  });
}
