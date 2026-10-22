import type { EmployeeSession } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, isUnreachable } from '@/shared/api';
import {
  forgetTerminal,
  rememberSession,
  rememberedSession,
} from '@/shared/lib/terminal-cache';
import {
  clearSignOutPending,
  isSignOutPending,
} from '../model/pending-sign-out';

export const sessionQueryKey = ['employee-session'] as const;

/**
 * The session as the server answers it: null when there is none (401); an outage throws. A sign-out that waits for the
 * server (F3, S5) goes here: while the mark stands the session behind the cookie is the signed-out one, so it is ended
 * now. The mark is read after the answer — a sign-in drops it before its own request, so a sign-in on its way is never
 * signed out from here.
 */
export async function requestSession(
  options: { timeoutMs?: number } = {},
): Promise<EmployeeSession | null> {
  let session: EmployeeSession;
  try {
    session = await apiRequest('sessions.current', options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSignOutPending();
      void forgetTerminal();
      return null;
    }
    throw error;
  }
  if (isSignOutPending()) {
    // failing, the mark stays and the terminal stays locked until the next try
    await apiRequest('sessions.delete', options).catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    });
    clearSignOutPending();
    void forgetTerminal();
    return null;
  }
  void rememberSession(session);
  return session;
}

/**
 * Current employee session; null when there is none (401). During an outage a POS terminal
 * reopens with the profile of its last session (ADR-0015, ось 3): the server still decides every
 * operation when the outbox sends it. Not after a sign-out that waits for the server (F3, S5): the terminal stays
 * locked — a PIN cannot sign in offline anyway.
 */
export async function fetchSession(): Promise<EmployeeSession | null> {
  try {
    return await requestSession();
  } catch (error) {
    if (isUnreachable(error)) {
      if (isSignOutPending()) return null;
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
