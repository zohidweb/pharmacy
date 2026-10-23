import { onlineManager, type QueryClient } from '@tanstack/react-query';
import {
  isSignOutPending,
  onSignOutPendingElsewhere,
} from '../model/pending-sign-out';
import { sessionQueryKey } from './session-queries';
import { resetSession } from './session-reset';

/** How often a sign-out that waits for the server is tried again while online: the first try may meet a server error. */
const SIGN_OUT_RETRY_MS = 30_000;

/**
 * A sign-out that waits for the server (F3, S5) goes as soon as the connection is back, and every SIGN_OUT_RETRY_MS
 * after it: the session is asked again and requestSession ends it. A session in the cache came with a sign-in, which
 * drops the mark — it is never ended from here. A sign-out marked in another tab signs this tab out too. Returns the
 * unsubscribe.
 */
export function watchPendingSignOut(queryClient: QueryClient): () => void {
  const retry = () => {
    if (!isSignOutPending() || !onlineManager.isOnline()) return;
    if (queryClient.getQueryData(sessionQueryKey)) return;
    void queryClient.invalidateQueries(
      { queryKey: sessionQueryKey },
      { cancelRefetch: false },
    );
  };
  const timer = setInterval(retry, SIGN_OUT_RETRY_MS);
  const unsubscribe = onlineManager.subscribe((online) => {
    if (online) retry();
  });
  const stopFollowing = onSignOutPendingElsewhere(() =>
    resetSession(queryClient),
  );
  return () => {
    clearInterval(timer);
    unsubscribe();
    stopFollowing();
  };
}
