import {
  createTestRedis,
  flushTestRedis,
} from '../../../test/integration/redis';
import type { RedisClient } from '../../core/redis/redis.tokens';
import {
  LOGIN_LIMITER_DEFAULTS,
  LoginLimiter,
  loginLimiterKey,
  type LoginLimiterOptions,
  RedisLoginLimiter,
} from './login-limiter';

// LoginLimiter on the real Redis (logical database 15; auth design 2026-10-02, section 6, step 3).
// Every sign-in attempt reserves its slot atomically before the password is hashed: 5 attempts
// within 900 s are allowed and the 5th locks the identifier for 900 s; a repeated lock within a
// day lasts 3600 s; a successful sign-in resets the count.

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const KEY = loginLimiterKey('login', 'farida.r');

type Attempt = Awaited<ReturnType<LoginLimiter['tryAcquire']>>;

const retryAfter = (attempt: Attempt): number | null =>
  attempt.allowed ? null : attempt.retryAfterSeconds;

describe('LoginLimiter (integration)', () => {
  let redis: RedisClient;

  const limiter = (overrides: Partial<LoginLimiterOptions> = {}) =>
    new RedisLoginLimiter(redis, { ...LOGIN_LIMITER_DEFAULTS, ...overrides });

  async function acquire(
    target: LoginLimiter,
    times: number,
    key = KEY,
  ): Promise<Attempt[]> {
    const attempts: Attempt[] = [];
    for (let i = 0; i < times; i++) attempts.push(await target.tryAcquire(key));
    return attempts;
  }

  beforeAll(async () => {
    redis = await createTestRedis();
  });

  beforeEach(async () => {
    await flushTestRedis(redis);
  });

  afterAll(async () => {
    await redis.close();
  });

  it('builds the key from the kind and the SHA-256 of the value, never the value itself', () => {
    expect(KEY).toMatch(/^login:[0-9a-f]{64}$/);
    expect(KEY).not.toContain('farida');
  });

  it('defaults to 5 attempts in 900 s, a 900 s lock and 3600 s for a repeat within a day', () => {
    expect(LOGIN_LIMITER_DEFAULTS).toEqual({
      maxFailures: 5,
      windowSeconds: 900,
      lockSeconds: 900,
      repeatLockSeconds: 3600,
      repeatWindowSeconds: 86400,
    });
  });

  it('allows 5 attempts, the 5th locks, the 6th is refused for about 900 s', async () => {
    const target = limiter();

    const attempts = await acquire(target, 6);

    expect(attempts.slice(0, 5).every((a) => a.allowed)).toBe(true);
    const left = retryAfter(attempts[5]);
    expect(left).toBeGreaterThan(895);
    expect(left).toBeLessThanOrEqual(900);
  });

  it('allows exactly 5 of 10 concurrent attempts, then stays locked for about 900 s', async () => {
    const target = limiter();

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => target.tryAcquire(KEY)),
    );

    expect(attempts.filter((a) => a.allowed)).toHaveLength(5);
    const refused = attempts.filter((a) => !a.allowed).map(retryAfter);
    expect(refused).toHaveLength(5);
    // A second lock would be a repeat lock (3600 s).
    const left = retryAfter(await target.tryAcquire(KEY));
    expect(left).toBeGreaterThan(895);
    expect(left).toBeLessThanOrEqual(900);
  });

  it('does not count refused attempts while locked', async () => {
    const target = limiter({ lockSeconds: 1 });
    await acquire(target, 5);
    await acquire(target, 3);
    await sleep(1_100);

    const attempts = await acquire(target, 5);

    // A fresh count after the lock: 5 allowed again (the 5th locks for the repeat duration).
    expect(attempts.every((a) => a.allowed)).toBe(true);
  });

  it('locks for 3600 s when locked again within a day', async () => {
    const target = limiter({ lockSeconds: 1 });
    await acquire(target, 5);
    await sleep(1_100);
    expect((await target.tryAcquire(KEY)).allowed).toBe(true);

    await acquire(target, 4);
    const left = retryAfter(await target.tryAcquire(KEY));
    expect(left).toBeGreaterThan(3595);
    expect(left).toBeLessThanOrEqual(3600);
  });

  it('forgets attempts older than the window', async () => {
    const target = limiter({ windowSeconds: 1 });
    await acquire(target, 4);
    await sleep(1_100);

    const attempts = await acquire(target, 4);

    expect(attempts.every((a) => a.allowed)).toBe(true);
    expect((await target.tryAcquire(KEY)).allowed).toBe(true);
  });

  it('reset lifts the lock and clears the count', async () => {
    const target = limiter();
    await acquire(target, 5);
    await target.reset(KEY);
    expect((await target.tryAcquire(KEY)).allowed).toBe(true);

    await target.reset(KEY);
    await acquire(target, 4);
    await target.reset(KEY);
    const attempts = await acquire(target, 5);
    expect(attempts.every((a) => a.allowed)).toBe(true);
  });

  it('keeps identifiers independent', async () => {
    const target = limiter();
    const other = loginLimiterKey('email', 'farida@example.tj');
    await acquire(target, 6);
    expect((await target.tryAcquire(other)).allowed).toBe(true);
  });
});
