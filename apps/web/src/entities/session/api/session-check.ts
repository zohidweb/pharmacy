import type { EmployeeSession } from '@pharmacy/shared-dto';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { requestSession, sessionQueryKey } from './session-queries';
import { resetSession } from './session-reset';

/** How long a checked session is trusted before a sale checks it again (security review 2026-10-22, F2, S3). */
export const SESSION_CHECK_MS = 60_000;
/** A check that the server does not answer in time leaves the sale to the buffer, as offline. */
export const SESSION_CHECK_TIMEOUT_MS = 3_000;

/**
 * The session before a sale online (security review 2026-10-22, F2). Without a live session the server takes a buffered
 * sale under the terminal (P9/P10) in the name of the cashier who has left, so the POS checks first — when the session
 * query was last answered more than SESSION_CHECK_MS ago; the check itself is activity, it keeps the session alive.
 * Offline, or without an answer within SESSION_CHECK_TIMEOUT_MS, the sale goes as an offline one (ADR-0015) and the
 * session query is left as it was: a failed check must not turn the POS into an error screen.
 * null — the session is gone and the browser state is reset (the shell opens the PIN form); undefined — not checked.
 */
export async function ensureSession(
  queryClient: QueryClient,
): Promise<EmployeeSession | null | undefined> {
  if (!onlineManager.isOnline()) return undefined;
  const state = queryClient.getQueryState<EmployeeSession | null>(
    sessionQueryKey,
  );
  if (state?.data && Date.now() - state.dataUpdatedAt < SESSION_CHECK_MS)
    return state.data;
  let session: EmployeeSession | null;
  try {
    session = await requestSession({ timeoutMs: SESSION_CHECK_TIMEOUT_MS });
  } catch {
    // unreachable, timed out or failed: the server decides when the buffer sends the sale
    return undefined;
  }
  if (session === null) resetSession(queryClient);
  else queryClient.setQueryData(sessionQueryKey, session);
  return session;
}
