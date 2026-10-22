import type { EmployeeSession } from '@pharmacy/shared-dto';
import {
  onlineManager,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { ApiError, apiRequest, isUnreachable } from '@/shared/api';
import {
  forgetTerminal,
  rememberSession,
  rememberedSession,
} from '@/shared/lib/terminal-cache';
import { clearSignOutPending, pendingSignOut } from '../model/pending-sign-out';

export const sessionQueryKey = ['employee-session'] as const;

/**
 * The session as the server answers it: null when there is none (401); an outage throws. A sign-out that waits for the
 * server (F3, S5) goes here: the same session as the one signed out is ended now, another one (a new sign-in on the
 * terminal) only drops the mark.
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
  const pending = pendingSignOut();
  if (pending !== null) {
    if (session.authenticatedAt === pending) {
      // failing, the mark stays and the terminal stays locked until the next try
      await apiRequest('sessions.delete', options).catch((error: unknown) => {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      });
      clearSignOutPending();
      void forgetTerminal();
      return null;
    }
    clearSignOutPending();
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
      if (pendingSignOut() !== null) return null;
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

/** How often a sign-out that waits for the server is tried again while online: the first try may meet a server error. */
const SIGN_OUT_RETRY_MS = 30_000;

/**
 * A sign-out that waits for the server goes as soon as the connection is back, and every SIGN_OUT_RETRY_MS after it
 * (F3, S5): the session is asked again and fetchSession ends it. A new sign-in in this browser has replaced the cookie
 * of the signed-out session — nothing is left to end from here, the mark is dropped. Returns the unsubscribe.
 */
export function retrySignOutOnReconnect(queryClient: QueryClient): () => void {
  const retry = () => {
    const pending = pendingSignOut();
    if (pending === null || !onlineManager.isOnline()) return;
    const session = queryClient.getQueryData<EmployeeSession | null>(
      sessionQueryKey,
    );
    if (session) {
      if (session.authenticatedAt !== pending) clearSignOutPending();
      return;
    }
    void queryClient.invalidateQueries(
      { queryKey: sessionQueryKey },
      { cancelRefetch: false },
    );
  };
  const timer = setInterval(retry, SIGN_OUT_RETRY_MS);
  const unsubscribe = onlineManager.subscribe((online) => {
    if (online) retry();
  });
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
