/*
 * A sign-out that did not reach the server (security review 2026-10-22, F3, S5). The browser is locked at once; while
 * this mark stands, the session behind the browser's cookie is the signed-out one — only a sign-in gives the browser
 * another cookie, and a sign-in drops the mark first (signIn). The session is not identified by its `authenticatedAt`:
 * the server moves it on a password confirmation. Without localStorage there is no mark: the browser is still locked,
 * only a reload during the outage may show the old session again.
 */
const KEY = 'pharmacy-sign-out-pending';

/** The value is the time of the sign-out, for whoever looks at the storage. */
export function markSignOutPending(): void {
  try {
    localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // storage unavailable: no mark
  }
}

export function isSignOutPending(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSignOutPending(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}

/** A sign-out marked in another tab of this browser: the tabs share the cookie, so they are signed out together. */
export function onSignOutPendingElsewhere(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY && event.newValue !== null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
