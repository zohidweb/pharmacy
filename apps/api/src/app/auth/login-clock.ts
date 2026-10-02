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
