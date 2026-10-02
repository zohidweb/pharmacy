import { sha256Hex } from '../../core/crypto';
import type { LoginKind } from '../../core/database';
import type { RedisClient } from '../../core/redis/redis.tokens';

export interface LoginLimiterOptions {
  /** Failures within the window that lock the identifier (LOGIN_MAX_FAILURES). */
  maxFailures: number;
  /** Failures older than this are forgotten. */
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

/** Limiter key of a normalized identifier: the kind and a SHA-256 of the value, never the value. */
export function loginLimiterKey(kind: LoginKind, value: string): string {
  return `${kind}:${sha256Hex(value)}`;
}

const PREFIX = 'login-limit';

// One atomic failure step (KEYS: failures, lock, lock history; ARGV: max failures, window ms,
// lock ms, repeat lock ms, history ms):
// - while locked, a failure is not counted (the lock is neither extended nor repeated);
// - INCR the failures; the first one (or a key that lost its expiry) opens the window;
// - on reaching the maximum: lock for the repeat duration if an earlier lock is remembered,
//   otherwise for the first duration; remember the lock; drop the failures (a fresh count after).
const RECORD_FAILURE_SCRIPT = `
local failures, lock, history = KEYS[1], KEYS[2], KEYS[3]
if redis.call('PTTL', lock) > 0 then
  return 0
end
local count = redis.call('INCR', failures)
if count == 1 or redis.call('PTTL', failures) < 0 then
  redis.call('PEXPIRE', failures, ARGV[2])
end
if count >= tonumber(ARGV[1]) then
  local lockMs = ARGV[3]
  if redis.call('EXISTS', history) == 1 then
    lockMs = ARGV[4]
  end
  redis.call('SET', lock, '1', 'PX', lockMs)
  redis.call('SET', history, '1', 'PX', ARGV[5])
  redis.call('DEL', failures)
  return 1
end
return 0
`;

const ms = (seconds: number): string => String(seconds * 1000);

// Failed sign-ins per identifier in Redis, shared by all API instances (cloud; the offline store
// gets its own implementation with part 4 of the auth design). Keys carry a hash of the
// identifier only, so Redis holds no personal data.
export class LoginLimiter {
  constructor(
    private readonly redis: RedisClient,
    private readonly options: LoginLimiterOptions,
  ) {}

  /** Seconds until the identifier is unlocked, or null when it is not locked. */
  async isLocked(key: string): Promise<number | null> {
    const left = await this.redis.pTTL(this.keys(key).lock);
    return left > 0 ? Math.ceil(left / 1000) : null;
  }

  async recordFailure(key: string): Promise<void> {
    const { failures, lock, history } = this.keys(key);
    await this.redis.eval(RECORD_FAILURE_SCRIPT, {
      keys: [failures, lock, history],
      arguments: [
        String(this.options.maxFailures),
        ms(this.options.windowSeconds),
        ms(this.options.lockSeconds),
        ms(this.options.repeatLockSeconds),
        ms(this.options.repeatWindowSeconds),
      ],
    });
  }

  /**
   * After a successful sign-in: clears the failures and any lock. The lock history stays until it
   * expires, so a new series of failures within a day still gets the longer lock.
   */
  async reset(key: string): Promise<void> {
    const { failures, lock } = this.keys(key);
    await this.redis.del([failures, lock]);
  }

  private keys(key: string) {
    return {
      failures: `${PREFIX}:${key}:failures`,
      lock: `${PREFIX}:${key}:lock`,
      history: `${PREFIX}:${key}:history`,
    };
  }
}
