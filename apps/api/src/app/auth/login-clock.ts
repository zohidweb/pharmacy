import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Time source of the login failure floor (SessionsService): injectable, so unit tests replace it
// with a manual clock and never really wait. DI token.
export abstract class LoginClock {
  /** Monotonic milliseconds. */
  abstract now(): number;
  abstract sleep(ms: number): Promise<void>;
  /** A random integer in [0, maxMs]. */
  abstract jitterMs(maxMs: number): number;
}

export class SystemLoginClock extends LoginClock {
  now(): number {
    return performance.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  jitterMs(maxMs: number): number {
    return randomInt(0, maxMs + 1);
  }
}

// Upper bound of the random part added to LOGIN_FAILURE_FLOOR_MS.
const FAILURE_JITTER_MAX_MS = 50;

/**
 * Pads a failed attempt to at least floorMs (plus up to FAILURE_JITTER_MAX_MS of jitter) from
 * `started`, so its timing does not tell an unknown identifier from a known one: their paths
 * differ in database work. Shared by sign-in and activation.
 */
export async function padFailure(
  clock: LoginClock,
  floorMs: number,
  started: number,
): Promise<void> {
  const floor = floorMs + clock.jitterMs(FAILURE_JITTER_MAX_MS);
  const wait = floor - (clock.now() - started);
  if (wait > 0) await clock.sleep(wait);
}
