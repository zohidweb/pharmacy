import type { EmployeeSession } from '@pharmacy/shared-dto';
import type { QueryClient } from '@tanstack/react-query';
import { rememberSession } from '@/shared/lib/terminal-cache';
import {
  clearSignOutPending,
  isSignOutPending,
  markSignOutPending,
} from '../model/pending-sign-out';
import { sessionQueryKey } from './session-queries';

/**
 * A sign-in in this browser (password or PIN): the session it returns becomes the current one and is remembered for an
 * outage (ADR-0015, ось 3). The only way the browser gets another session cookie, so a sign-out that waits for the
 * server (F3, S5) is dropped before the request — a pending retry must not end the new session — and comes back if the
 * sign-in fails; a session request on its way is cancelled, its answer must not overwrite this one.
 */
export async function signIn(
  queryClient: QueryClient,
  request: () => Promise<EmployeeSession>,
): Promise<EmployeeSession> {
  const signOutPending = isSignOutPending();
  clearSignOutPending();
  await queryClient.cancelQueries({ queryKey: sessionQueryKey });
  let session: EmployeeSession;
  try {
    session = await request();
  } catch (error) {
    if (signOutPending) markSignOutPending();
    throw error;
  }
  queryClient.setQueryData(sessionQueryKey, session);
  void rememberSession(session);
  return session;
}
