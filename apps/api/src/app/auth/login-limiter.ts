import { sha256Hex } from '../../core/crypto';
import type { LoginKind } from '../../core/database';
import type { RedisClient } from '../../core/redis/redis.tokens';

export interface LoginLimiterOptions {
  /** Attempts within the window; the last one locks the identifier (LOGIN_MAX_FAILURES). */
  maxFailures: number;
  /** Attempts older than this are forgotten. */
  windowSeconds: number;
  /** First lock (LOGIN_LOCK_SECONDS). */
  lockSeconds: number;
  /** A lock that follows an earlier one within repeatWindowSeconds. */
  repeatLockSeconds: number;
  repeatWindowSeconds: number;
}

// Auth design 2026-10-02, section 6, step 3 and section 11.
export const LOGIN_LIMITER_DEFAULTS: Readonly<LoginLimiterOptions> = {
  maxFailures: 5,
  windowSeconds: 900,
  lockSeconds: 900,
  repeatLockSeconds: 3600,
  repeatWindowSeconds: 86400,
};

export type LoginAttempt =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Limiter key of a normalized identifier: the kind and a SHA-256 of the value, never the value. */
export function loginLimiterKey(kind: LoginKind, value: string): string {
  return `${kind}:${sha256Hex(value)}`;
}

const PREFIX = 'login-limit';

// One atomic reservation of a sign-in attempt, made before the password is hashed (KEYS: attempts,
// lock, lock history; ARGV: max attempts, window ms, lock ms, repeat lock ms, history ms). Returns
// 0 when the attempt may proceed, otherwise the milliseconds left of the lock:
// - while locked, the attempt is refused and not counted (the lock is neither extended nor
//   repeated);
// - INCR the attempts; the first one (or a key that lost its expiry) opens the window;
// - the attempt that reaches the maximum still proceeds, and locks: for the repeat duration if an
//   earlier lock is remembered, otherwise for the first duration; the lock is remembered and the
//   count dropped (a fresh count after the lock).
// Concurrent requests cannot pass a check together and act later: at most maxFailures attempts
// per window are ever allowed.
const TRY_ACQUIRE_SCRIPT = `
local attempts, lock, history = KEYS[1], KEYS[2], KEYS[3]
local lockLeft = redis.call('PTTL', lock)
if lockLeft > 0 then
  return lockLeft
end
local count = redis.call('INCR', attempts)
if count == 1 or redis.call('PTTL', attempts) < 0 then
  redis.call('PEXPIRE', attempts, ARGV[2])
end
if count >= tonumber(ARGV[1]) then
  local lockMs = ARGV[3]
  if redis.call('EXISTS', history) == 1 then
    lockMs = ARGV[4]
  end
  redis.call('SET', lock, '1', 'PX', lockMs)
  redis.call('SET', history, '1', 'PX', ARGV[5])
  redis.call('DEL', attempts)
end
return 0
`;

const ms = (seconds: number): string => String(seconds * 1000);

// Port: attempts per key (sign-in, activation, password and PIN changes, terminal PIN) with a lock
// after maxFailures within the window. Redis in the cloud (shared by all API instances), process
// memory on an offline store (one process, ADR-0008). DI token.
export abstract class LoginLimiter {
  /** Reserves one attempt, or refuses it with the seconds until the key is unlocked. */
  abstract tryAcquire(key: string): Promise<LoginAttempt>;

  /** After a success: clears the attempts and any lock (the lock history stays). */
  abstract reset(key: string): Promise<void>;
}

// Sign-in attempts per identifier in Redis, shared by all API instances (cloud; the offline store
// gets its own implementation with part 4 of the auth design). Keys carry a hash of the
// identifier only, so Redis holds no personal data.
export class RedisLoginLimiter extends LoginLimiter {
  constructor(
    private readonly redis: RedisClient,
    private readonly options: LoginLimiterOptions,
  ) {
    super();
  }

  /** Reserves one attempt, or refuses it with the seconds until the identifier is unlocked. */
  async tryAcquire(key: string): Promise<LoginAttempt> {
    const { attempts, lock, history } = this.keys(key);
    const reply = await this.redis.eval(TRY_ACQUIRE_SCRIPT, {
      keys: [attempts, lock, history],
      arguments: [
        String(this.options.maxFailures),
        ms(this.options.windowSeconds),
        ms(this.options.lockSeconds),
        ms(this.options.repeatLockSeconds),
        ms(this.options.repeatWindowSeconds),
      ],
    });
    if (typeof reply !== 'number') {
      throw new Error('Unexpected login limiter script reply');
    }
    return reply > 0
      ? { allowed: false, retryAfterSeconds: Math.ceil(reply / 1000) }
      : { allowed: true };
  }

  /**
   * After a successful sign-in: clears the attempts and any lock. The lock history stays until it
   * expires, so a new series of failures within a day still gets the longer lock.
   */
  async reset(key: string): Promise<void> {
    const { attempts, lock } = this.keys(key);
    await this.redis.del([attempts, lock]);
  }

  private keys(key: string) {
    return {
      attempts: `${PREFIX}:${key}:attempts`,
      lock: `${PREFIX}:${key}:lock`,
      history: `${PREFIX}:${key}:history`,
    };
  }
}
