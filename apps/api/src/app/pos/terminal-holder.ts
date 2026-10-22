import type { PinSignIn } from '../audit/pin-sign-ins';

/** The clock of the PC may jump between a sale and its sending (P10): a sign-in this close counts. */
export const AUTHOR_SIGN_IN_TOLERANCE_MS = 5 * 60_000;

/**
 * Whether the author held the terminal at the moment of an operation sent under it (spec
 * 2026-10-21-pos-offline-limits, P10; ADR-0008, amendment 2026-10-21): the terminal is held by the last one who
 * signed in on it by PIN, and the author must hold it at some instant of `moment ± toleranceMs`. `signIns` are the
 * sign-ins of the terminal in ascending order, no older than the buffer limit before the moment (the caller's window).
 */
export function heldBy(
  signIns: readonly PinSignIn[],
  authorId: string,
  moment: Date,
  toleranceMs: number,
): boolean {
  const start = moment.getTime() - toleranceMs;
  const end = moment.getTime() + toleranceMs;
  let holder: string | null = null;
  for (const signIn of signIns) {
    const at = signIn.at.getTime();
    if (at <= start) {
      holder = signIn.employeeId;
    } else if (at <= end && signIn.employeeId === authorId) {
      return true;
    }
  }
  return holder === authorId;
}
