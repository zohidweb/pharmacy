import type { EmployeeSession } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, isUnreachable } from '@/shared/api';
import {
  forgetTerminal,
  rememberSession,
  rememberedSession,
} from '@/shared/lib/terminal-cache';

export const sessionQueryKey = ['employee-session'] as const;

/**
 * Current employee session; null when there is none (401). During an outage a POS terminal
 * reopens with the profile of its last session (ADR-0015, ось 3): the server still decides every
 * operation when the outbox sends it.
 */
export async function fetchSession(): Promise<EmployeeSession | null> {
  try {
    const session = await apiRequest('sessions.current');
    void rememberSession(session);
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      void forgetTerminal();
      return null;
    }
    if (isUnreachable(error)) {
      const remembered = await rememberedSession();
      if (remembered) return remembered;
    }
    throw error;
  }
}

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    // runs during an outage too: a terminal falls back to its remembered session
    networkMode: 'always',
  });
}
