import {
  createTestRedis,
  flushTestRedis,
} from '../../../test/integration/redis';
import type { RedisClient } from '../../core/redis/redis.tokens';
import { RedisThrottlerStorage } from './redis-throttler.storage';

// RedisThrottlerStorage on the real Redis (logical database 15): fixed window per key and
// throttler, atomic increment with expiry, a block of blockDuration once the limit is exceeded,
// no counting while blocked, a fresh window after the block. Times are returned in seconds, as
// the ThrottlerGuard of @nestjs/throttler 6 expects (Retry-After).

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('RedisThrottlerStorage (integration)', () => {
  let redis: RedisClient;
  let storage: RedisThrottlerStorage;

  beforeAll(async () => {
    redis = await createTestRedis();
    storage = new RedisThrottlerStorage(redis);
  });

  beforeEach(async () => {
    await flushTestRedis(redis);
  });

  afterAll(async () => {
    await redis.close();
  });

  it('counts hits up to the limit without blocking', async () => {
    const records = [];
    for (let i = 0; i < 3; i++) {
      records.push(await storage.increment('k1', 60_000, 3, 30_000, 'default'));
    }

    expect(records.map((r) => r.totalHits)).toEqual([1, 2, 3]);
    for (const record of records) {
      expect(record.isBlocked).toBe(false);
      expect(record.timeToBlockExpire).toBe(0);
      expect(record.timeToExpire).toBeGreaterThan(0);
      expect(record.timeToExpire).toBeLessThanOrEqual(60);
    }
  });

  it('blocks for blockDuration once the limit is exceeded and stays blocked', async () => {
    await storage.increment('k2', 60_000, 1, 30_000, 'default');

    const over = await storage.increment('k2', 60_000, 1, 30_000, 'default');
    expect(over.isBlocked).toBe(true);
    expect(over.timeToBlockExpire).toBeGreaterThan(29);
    expect(over.timeToBlockExpire).toBeLessThanOrEqual(30);

    const again = await storage.increment('k2', 60_000, 1, 30_000, 'default');
    expect(again.isBlocked).toBe(true);
    expect(again.timeToBlockExpire).toBeLessThanOrEqual(30);
  });

  it('starts a fresh window after the block expires', async () => {
    await storage.increment('k3', 5_000, 1, 300, 'default');
    expect(
      (await storage.increment('k3', 5_000, 1, 300, 'default')).isBlocked,
    ).toBe(true);
    // Hits while blocked are not counted.
    expect(
      (await storage.increment('k3', 5_000, 1, 300, 'default')).isBlocked,
    ).toBe(true);

    await sleep(400);

    const after = await storage.increment('k3', 5_000, 1, 300, 'default');
    expect(after).toMatchObject({
      totalHits: 1,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('starts a fresh window after the ttl expires', async () => {
    await storage.increment('k4', 300, 5, 300, 'default');
    await storage.increment('k4', 300, 5, 300, 'default');

    await sleep(400);

    expect(
      (await storage.increment('k4', 300, 5, 300, 'default')).totalHits,
    ).toBe(1);
  });

  it('keeps throttler names apart', async () => {
    await storage.increment('k5', 60_000, 1, 30_000, 'short');
    const other = await storage.increment('k5', 60_000, 1, 30_000, 'long');

    expect(other).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('never leaves a key without an expiry', async () => {
    await storage.increment('k6', 60_000, 1, 30_000, 'default');
    await storage.increment('k6', 60_000, 1, 30_000, 'default');

    const keys = await redis.keys('*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(await redis.pTTL(key)).toBeGreaterThan(0);
    }
  });

  it('is atomic under concurrent increments', async () => {
    const records = await Promise.all(
      Array.from({ length: 25 }, () =>
        storage.increment('k7', 60_000, 10, 30_000, 'default'),
      ),
    );

    expect(records.filter((r) => !r.isBlocked)).toHaveLength(10);
    expect(
      records
        .filter((r) => !r.isBlocked)
        .map((r) => r.totalHits)
        .sort((x, y) => x - y),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
