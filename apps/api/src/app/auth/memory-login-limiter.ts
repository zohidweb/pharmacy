import {
  type LoginAttempt,
  LoginLimiter,
  type LoginLimiterOptions,
} from './login-limiter';

interface KeyState {
  /** Attempts in the current window and when the window ends (ms). */
  attempts: number;
  windowEndsAt: number;
  /** End of the current lock (ms), 0 when not locked. */
  lockedUntil: number;
  /** End of the remembered lock history (ms), 0 when none. */
  historyUntil: number;
}

/** Keys kept at most; the least recently used are evicted first. */
export const MEMORY_LIMITER_MAX_KEYS = 10_000;

// In-memory implementation for an offline store: one API process (ADR-0008), so no shared state
// is needed. Same semantics as the Redis script (login-limiter.ts): a locked attempt is refused
// and not counted; the attempt that reaches maxFailures still proceeds and locks — for
// repeatLockSeconds when an earlier lock is remembered within repeatWindowSeconds, otherwise for
// lockSeconds — and the count starts again. A restart forgets everything (plan auth-part4,
// Global Constraints); the employee's PIN lock lives in the database and survives it.
export class MemoryLoginLimiter extends LoginLimiter {
  private readonly keys = new Map<string, KeyState>();

  constructor(
    private readonly options: LoginLimiterOptions,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  tryAcquire(key: string): Promise<LoginAttempt> {
    const now = this.now();
    const state = this.take(key, now);

    if (state.lockedUntil > now) {
      this.keep(key, state);
      return Promise.resolve({
        allowed: false,
        retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000),
      });
    }

    if (state.windowEndsAt <= now) {
      state.attempts = 0;
      state.windowEndsAt = now + this.options.windowSeconds * 1000;
    }
    state.attempts += 1;

    if (state.attempts >= this.options.maxFailures) {
      const repeated = state.historyUntil > now;
      state.lockedUntil =
        now +
        (repeated ? this.options.repeatLockSeconds : this.options.lockSeconds) * 1000;
      state.historyUntil = now + this.options.repeatWindowSeconds * 1000;
      state.attempts = 0;
      state.windowEndsAt = 0;
    }
    this.keep(key, state);
    return Promise.resolve({ allowed: true });
  }

  reset(key: string): Promise<void> {
    const state = this.keys.get(key);
    if (state) {
      state.attempts = 0;
      state.windowEndsAt = 0;
      state.lockedUntil = 0;
      // The lock history stays until it expires, as in Redis.
      if (state.historyUntil <= this.now()) this.keys.delete(key);
    }
    return Promise.resolve();
  }

  // The live state of a key; an entry with nothing left to remember starts fresh.
  private take(key: string, now: number): KeyState {
    const state = this.keys.get(key);
    if (state) {
      this.keys.delete(key);
      if (state.windowEndsAt > now || state.lockedUntil > now || state.historyUntil > now) {
        return state;
      }
    }
    return { attempts: 0, windowEndsAt: 0, lockedUntil: 0, historyUntil: 0 };
  }

  // Re-inserted last, so a Map's insertion order keeps the least recently used key first.
  private keep(key: string, state: KeyState): void {
    if (this.keys.size >= MEMORY_LIMITER_MAX_KEYS) {
      const oldest = this.keys.keys().next();
      if (!oldest.done) this.keys.delete(oldest.value);
    }
    this.keys.set(key, state);
  }
}
