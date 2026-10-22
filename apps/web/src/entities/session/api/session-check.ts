import type { EmployeeSession } from '@pharmacy/shared-dto';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { requestSession, sessionQueryKey } from './session-queries';
import { resetSession } from './session-reset';

/** How long a checked session is trusted before a sale checks it again (security review 2026-10-22, F2, S3). */
const SESSION_CHECK_MS = 60_000;
/** A check that the server does not answer in time leaves the operation to the buffer, as offline. */
const SESSION_CHECK_TIMEOUT_MS = 3_000;

let checking: Promise<EmployeeSession | null | undefined> | null = null;

/**
 * Asks the server for the session now (F2, S4): a session — the cache takes it; none — the browser state is reset
 * (every query of the employee dropped, the shell opens the PIN form); no answer within SESSION_CHECK_TIMEOUT_MS or an
 * error — undefined, and the session query is left as it was: a failed check must not turn the POS into an error
 * screen. Checks running at once share one request.
 */
export function recheckSession(
  queryClient: QueryClient,
): Promise<EmployeeSession | null | undefined> {
  checking ??= (async () => {
    try {
      const session = await requestSession({
        timeoutMs: SESSION_CHECK_TIMEOUT_MS,
      });
      if (session === null) resetSession(queryClient);
      else queryClient.setQueryData(sessionQueryKey, session);
      return session;
    } catch {
      // unreachable, timed out or failed: the server decides when the buffer sends the operation
      return undefined;
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/**
 * The session before an operation of the POS buffer online — a sale, opening a shift, a cash movement, closing a shift
 * (security review 2026-10-22, F2). Without a live session the server takes a buffered operation under the terminal
 * (P9/P10) in the name of the cashier who has left, so the POS checks first — when the session query was last answered
 * more than SESSION_CHECK_MS ago; the check itself is activity, it keeps the session alive. Offline, or without an
 * answer, the operation goes as an offline one (ADR-0015).
 * null — the session is gone and the browser state is reset; undefined — not checked.
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
  return recheckSession(queryClient);
}
