/*
 * A sign-out that did not reach the server (security review 2026-10-22, F3, S5). The browser is locked at once; this
 * mark keeps the old session from coming back until the sign-out reaches the server. It holds the `authenticatedAt` of
 * that session, so a new sign-in on the terminal is not taken for it. Without localStorage there is no mark: the
 * browser is still locked, only a reload during the outage may show the old session again.
 */
const KEY = 'pharmacy-sign-out-pending';

export function markSignOutPending(authenticatedAt: string): void {
  try {
    localStorage.setItem(KEY, authenticatedAt);
  } catch {
    // storage unavailable: no mark
  }
}

/** The `authenticatedAt` of the session whose sign-out waits for the server, or null. */
export function pendingSignOut(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearSignOutPending(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}
