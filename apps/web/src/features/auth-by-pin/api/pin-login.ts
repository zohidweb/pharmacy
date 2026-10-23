import type { EmployeeSession, PinLoginRequest } from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signIn } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { setLocale } from '@/shared/i18n';

/** POST /terminal-sessions: replaces the previous PIN session of this terminal. */
export function usePinLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PinLoginRequest) =>
      signIn(queryClient, () =>
        apiRequest('terminalSessions.create', { body }),
      ),
    onSuccess: (session: EmployeeSession) => {
      setLocale(session.locale);
    },
  });
}
