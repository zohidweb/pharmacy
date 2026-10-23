import type { EmployeeSession, PinLoginRequest } from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signIn } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { setLocale } from '@/shared/i18n';

/**
 * POST /terminal-sessions: replaces the previous PIN session of this terminal. Goes during an outage too and fails with
 * «Нет связи»: a sign-in never waits for the connection to sign the cashier in later, when they may have left.
 */
export function usePinLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PinLoginRequest) =>
      signIn(queryClient, () =>
        apiRequest('terminalSessions.create', { body }),
      ),
    networkMode: 'always',
    onSuccess: (session: EmployeeSession) => {
      setLocale(session.locale);
    },
  });
}
