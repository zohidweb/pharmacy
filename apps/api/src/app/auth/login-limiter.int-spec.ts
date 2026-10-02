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
} from './login-limiter';

// LoginLimiter on the real Redis (logical database 15; auth design 2026-10-02, section 6, step 3):
// 5 failures within 900 s lock the identifier for 900 s; a repeated lock within a day lasts
// 3600 s; the step is atomic, so concurrent failures lock exactly once, on the 5th.

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const KEY = loginLimiterKey('login', 'farida.r');

describe('LoginLimiter (integration)', () => {
  let redis: RedisClient;

  const limiter = (overrides: Partial<LoginLimiterOptions> = {}) =>
    new LoginLimiter(redis, { ...LOGIN_LIMITER_DEFAULTS, ...overrides });

  async function fail(target: LoginLimiter, times: number, key = KEY) {
    for (let i = 0; i < times; i++) await target.recordFailure(key);
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

  it('defaults to 5 failures in 900 s, a 900 s lock and 3600 s for a repeat within a day', () => {
    expect(LOGIN_LIMITER_DEFAULTS).toEqual({
      maxFailures: 5,
      windowSeconds: 900,
      lockSeconds: 900,
      repeatLockSeconds: 3600,
      repeatWindowSeconds: 86400,
    });
  });

  it('is not locked after 4 failures', async () => {
    const target = limiter();
    await fail(target, 4);
    await expect(target.isLocked(KEY)).resolves.toBeNull();
  });

  it('locks for about 900 s on the 5th failure', async () => {
    const target = limiter();
    await fail(target, 5);
    const left = await target.isLocked(KEY);
    expect(left).toBeGreaterThan(895);
    expect(left).toBeLessThanOrEqual(900);
  });

  it('locks exactly once, on the 5th, under 10 concurrent failures', async () => {
    const target = limiter();
    await Promise.all(
      Array.from({ length: 10 }, () => target.recordFailure(KEY)),
    );
    // A second lock would be a repeat lock (3600 s).
    const left = await target.isLocked(KEY);
    expect(left).toBeGreaterThan(895);
    expect(left).toBeLessThanOrEqual(900);
  });

  it('does not count failures while locked', async () => {
    const target = limiter({ lockSeconds: 1 });
    await fail(target, 5);
    await fail(target, 3);
    await sleep(1_100);
    await expect(target.isLocked(KEY)).resolves.toBeNull();
    await fail(target, 4);
    await expect(target.isLocked(KEY)).resolves.toBeNull();
  });

  it('locks for 3600 s when locked again within a day', async () => {
    const target = limiter({ lockSeconds: 1 });
    await fail(target, 5);
    await sleep(1_100);
    await expect(target.isLocked(KEY)).resolves.toBeNull();

    await fail(target, 5);
    const left = await target.isLocked(KEY);
    expect(left).toBeGreaterThan(3595);
    expect(left).toBeLessThanOrEqual(3600);
  });

  it('forgets failures older than the window', async () => {
    const target = limiter({ windowSeconds: 1 });
    await fail(target, 4);
    await sleep(1_100);
    await fail(target, 1);
    await expect(target.isLocked(KEY)).resolves.toBeNull();
  });

  it('reset lifts the lock and clears the failure count', async () => {
    const target = limiter();
    await fail(target, 5);
    await target.reset(KEY);
    await expect(target.isLocked(KEY)).resolves.toBeNull();

    await fail(target, 4);
    await target.reset(KEY);
    await fail(target, 1);
    await expect(target.isLocked(KEY)).resolves.toBeNull();
  });

  it('keeps identifiers independent', async () => {
    const target = limiter();
    const other = loginLimiterKey('email', 'farida@example.tj');
    await fail(target, 5);
    await expect(target.isLocked(other)).resolves.toBeNull();
  });
});
