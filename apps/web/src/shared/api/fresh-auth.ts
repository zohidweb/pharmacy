import { ApiError } from './client';

/*
 * Fresh sign-in (ADR-0008, amendment 2026-10-06): actions on staff, roles, terminals and one's own
 * secrets need a password sign-in at most 15 minutes old. Instead of sending the employee back to
 * sign-in, `withFreshAuth` asks for the password in a dialog (features/confirm-password), confirms
 * the session and repeats the action once. One request is pending at a time: actions that fail
 * together wait for the same confirmation.
 */

/** The employee closed the dialog: the action is dropped without an error message. */
export class FreshAuthCancelled extends Error {
  constructor() {
    super('The password confirmation was cancelled');
    this.name = 'FreshAuthCancelled';
  }
}

export const isFreshAuthCancelled = (
  error: unknown,
): error is FreshAuthCancelled => error instanceof FreshAuthCancelled;

const isFreshAuthRequired = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 403 &&
  error.code === 'fresh_auth_required';

let pending: Promise<void> | null = null;
let settle: { resolve: () => void; reject: (error: unknown) => void } | null =
  null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function requestConfirmation(): Promise<void> {
  if (pending === null) {
    pending = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
    notify();
  }
  return pending;
}

function finish(outcome: 'confirmed' | 'cancelled') {
  const current = settle;
  pending = null;
  settle = null;
  notify();
  if (outcome === 'confirmed') current?.resolve();
  else current?.reject(new FreshAuthCancelled());
}

/** The dialog store: whether a confirmation is awaited, and how it ends. */
export const freshAuthStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isPending: (): boolean => pending !== null,
  confirmed: () => finish('confirmed'),
  cancelled: () => finish('cancelled'),
};

/** Runs the action; on 403 `fresh_auth_required` waits for the password and repeats it once. */
export async function withFreshAuth<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isFreshAuthRequired(error)) throw error;
    await requestConfirmation();
    return action();
  }
}
