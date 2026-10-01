import type { EmployeeSession, PinLoginRequest } from '@pharmacy/shared-dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionQueryKey } from '@/entities/session';
import { ApiError, apiRequest } from '@/shared/api';
import { setLocale } from '@/shared/i18n';

export const terminalQueryKey = ['terminal', 'current'] as const;

/** The terminal of this browser (device-cookie, ADR-0008); null when the browser is not bound. */
export function useBoundTerminal() {
  return useQuery({
    queryKey: terminalQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await apiRequest('terminals.current', { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  });
}

/** POST /terminal-sessions: replaces the previous PIN session of this terminal. */
export function usePinLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PinLoginRequest) =>
      apiRequest('terminalSessions.create', { body }),
    onSuccess: (session: EmployeeSession) => {
      queryClient.setQueryData(sessionQueryKey, session);
      setLocale(session.locale);
    },
  });
}
