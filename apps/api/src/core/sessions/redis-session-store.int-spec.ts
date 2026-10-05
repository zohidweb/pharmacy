import { createTestRedis, flushTestRedis } from '../../../test/integration/redis';
import type { RedisClient } from '../redis/redis.tokens';
import {
  PERMISSIONS_VERSION_TTL_SECONDS,
  RedisPermissionsVersionCache,
  RedisSessionStore,
} from './redis-session-store';
import type { SessionRecord } from './session-store';

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const EMPLOYEE = '0197a1b2-0000-7000-8000-000000000002';
const OTHER_EMPLOYEE = '0197a1b2-0000-7000-8000-000000000003';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'sid-1',
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    auth: 'password',
    authenticatedAt: new Date().toISOString(),
    permissions: ['pos:view', 'catalog:view'],
    permissionsVersion: 3,
    storeScope: 'all',
    currentStoreId: null,
    terminalId: null,
    terminalCredentialHash: null,
    locale: 'ru',
    idleTtlSeconds: 60,
    absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

describe('RedisSessionStore (integration)', () => {
  let redis: RedisClient;
  let store: RedisSessionStore;
  let versions: RedisPermissionsVersionCache;

  beforeAll(async () => {
    redis = await createTestRedis();
    store = new RedisSessionStore(redis);
    versions = new RedisPermissionsVersionCache(redis);
  });

  beforeEach(async () => {
    await flushTestRedis(redis);
  });

  afterAll(async () => {
    await redis.close();
  });

  it('create then lookup returns the record and the permissions version in one call', async () => {
    const created = record();
    await store.create(created);
    await versions.setIfGreater(TENANT, EMPLOYEE, 7);

    const spy = jest.spyOn(redis, 'mGet');
    const found = await store.lookup('sid-1', TENANT, EMPLOYEE);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(['sess:sid-1', `pv:${TENANT}:${EMPLOYEE}`]);
    spy.mockRestore();
    expect(found.session).toEqual(created);
    expect(found.permissionsVersion).toBe(7);
  });

  it('lookup reports a null version when the cache has none', async () => {
    await store.create(record());
    const found = await store.lookup('sid-1', TENANT, EMPLOYEE);
    expect(found.session).not.toBeNull();
    expect(found.permissionsVersion).toBeNull();
  });

  it('lookup of an unknown session id returns no session', async () => {
    await store.create(record());
    expect(await store.lookup('nope', TENANT, EMPLOYEE)).toEqual({
      session: null,
      permissionsVersion: null,
      terminalRevoked: false,
    });
  });

  it('lookup with a forged tenant or employee pairing returns no session', async () => {
    await store.create(record());
    expect((await store.lookup('sid-1', TENANT, OTHER_EMPLOYEE)).session).toBeNull();
    expect((await store.lookup('sid-1', 'other-tenant', EMPLOYEE)).session).toBeNull();
  });

  it('the session disappears after idleTtlSeconds', async () => {
    await store.create(record({ idleTtlSeconds: 1 }));
    expect((await store.lookup('sid-1', TENANT, EMPLOYEE)).session).not.toBeNull();
    await sleep(1300);
    expect((await store.lookup('sid-1', TENANT, EMPLOYEE)).session).toBeNull();
  });

  it('the idle lifetime never outlasts absoluteExpiresAt', async () => {
    await store.create(
      record({ idleTtlSeconds: 600, absoluteExpiresAt: new Date(Date.now() + 1000).toISOString() }),
    );
    const ttl = await redis.pTTL('sess:sid-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1000);
    await sleep(1300);
    expect((await store.lookup('sid-1', TENANT, EMPLOYEE)).session).toBeNull();
  });

  it('an already expired session is not stored', async () => {
    await store.create(record({ absoluteExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(await redis.exists('sess:sid-1')).toBe(0);
  });

  it('touch extends the idle lifetime', async () => {
    await store.create(record({ idleTtlSeconds: 1 }));
    await sleep(600);
    await store.touch('sid-1', 2);
    await sleep(900); // past the original 1 s
    expect((await store.lookup('sid-1', TENANT, EMPLOYEE)).session).not.toBeNull();
  });

  it('touch does not extend beyond absoluteExpiresAt', async () => {
    await store.create(
      record({ idleTtlSeconds: 1, absoluteExpiresAt: new Date(Date.now() + 1500).toISOString() }),
    );
    await store.touch('sid-1', 600);
    const ttl = await redis.pTTL('sess:sid-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1500);
    await sleep(1800);
    expect((await store.lookup('sid-1', TENANT, EMPLOYEE)).session).toBeNull();
  });

  it('touch of a missing session does nothing', async () => {
    await store.touch('nope', 60);
    expect(await redis.exists('sess:nope')).toBe(0);
  });

  it('update patches allowed fields and keeps the remaining lifetime', async () => {
    await store.create(record({ idleTtlSeconds: 30 }));
    await store.update('sid-1', {
      permissions: [] as SessionRecord['permissions'],
      permissionsVersion: 4,
      storeScope: ['store-a'],
      currentStoreId: 'store-a',
      locale: 'tg',
    });
    const { session } = await store.lookup('sid-1', TENANT, EMPLOYEE);
    expect(session).toMatchObject({
      permissions: [],
      permissionsVersion: 4,
      storeScope: ['store-a'],
      currentStoreId: 'store-a',
      locale: 'tg',
      employeeId: EMPLOYEE,
    });
    const ttl = await redis.pTTL('sess:sid-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it('update does not resurrect a missing session', async () => {
    await store.update('nope', { locale: 'tg' });
    expect(await redis.exists('sess:nope')).toBe(0);
  });

  it('destroy removes the session and its entry in the employee set', async () => {
    await store.create(record());
    await store.destroy('sid-1');
    expect(await redis.exists('sess:sid-1')).toBe(0);
    expect(await redis.sCard(`emp-sess:${TENANT}:${EMPLOYEE}`)).toBe(0);
  });

  it('create keeps the employee set alive at least as long as the absolute lifetime', async () => {
    await store.create(record({ sessionId: 'a', absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    await store.create(record({ sessionId: 'b', absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString() }));
    const ttl = await redis.pTTL(`emp-sess:${TENANT}:${EMPLOYEE}`);
    expect(ttl).toBeGreaterThan(3_500_000);
  });

  it('destroyAllFor removes every session of the employee except the given one', async () => {
    await store.create(record({ sessionId: 'a' }));
    await store.create(record({ sessionId: 'b' }));
    await store.create(record({ sessionId: 'c' }));
    await store.create(record({ sessionId: 'x', employeeId: OTHER_EMPLOYEE }));

    await store.destroyAllFor(TENANT, EMPLOYEE, 'b');

    expect(await redis.exists('sess:a')).toBe(0);
    expect(await redis.exists('sess:c')).toBe(0);
    expect(await redis.exists('sess:b')).toBe(1);
    expect(await redis.exists('sess:x')).toBe(1);
    expect(await redis.sMembers(`emp-sess:${TENANT}:${EMPLOYEE}`)).toEqual(['b']);
  });

  it('destroyAllFor without an exception removes all and the set', async () => {
    await store.create(record({ sessionId: 'a' }));
    await store.create(record({ sessionId: 'b' }));
    await store.destroyAllFor(TENANT, EMPLOYEE);
    expect(await redis.exists(['sess:a', 'sess:b'])).toBe(0);
    expect(await redis.exists(`emp-sess:${TENANT}:${EMPLOYEE}`)).toBe(0);
  });

  it('destroyAllFor of an employee without sessions does nothing', async () => {
    await expect(store.destroyAllFor(TENANT, EMPLOYEE)).resolves.toBeUndefined();
  });
});

describe('RedisPermissionsVersionCache (integration)', () => {
  let redis: RedisClient;
  let versions: RedisPermissionsVersionCache;

  beforeAll(async () => {
    redis = await createTestRedis();
    versions = new RedisPermissionsVersionCache(redis);
  });

  beforeEach(async () => {
    await flushTestRedis(redis);
  });

  afterAll(async () => {
    await redis.close();
  });

  it('returns null for an unknown employee and the stored version after a write', async () => {
    expect(await versions.get(TENANT, EMPLOYEE)).toBeNull();
    await versions.setIfGreater(TENANT, EMPLOYEE, 12);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(12);
    await versions.setIfGreater(TENANT, EMPLOYEE, 13);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(13);
  });

  it('a cache miss is filled with the written version and a 300 s lifetime', async () => {
    await versions.setIfGreater(TENANT, EMPLOYEE, 5);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(5);
    const ttl = await redis.ttl(`pv:${TENANT}:${EMPLOYEE}`);
    expect(PERMISSIONS_VERSION_TTL_SECONDS).toBe(300);
    expect(ttl).toBeGreaterThan(PERMISSIONS_VERSION_TTL_SECONDS - 30);
    expect(ttl).toBeLessThanOrEqual(PERMISSIONS_VERSION_TTL_SECONDS);
  });

  it('out-of-order writes keep the greatest version (5 then 4 leaves 5)', async () => {
    await versions.setIfGreater(TENANT, EMPLOYEE, 5);
    await versions.setIfGreater(TENANT, EMPLOYEE, 4);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(5);
    await versions.setIfGreater(TENANT, EMPLOYEE, 5);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(5);
  });

  it('concurrent writes of different versions end at the greatest one', async () => {
    await Promise.all(
      [3, 9, 1, 7, 8, 2].map((version) => versions.setIfGreater(TENANT, EMPLOYEE, version)),
    );
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(9);
  });

  it('a write that changes the version refreshes the lifetime; a rejected one does not', async () => {
    const key = `pv:${TENANT}:${EMPLOYEE}`;
    await versions.setIfGreater(TENANT, EMPLOYEE, 5);
    await redis.expire(key, 20);

    await versions.setIfGreater(TENANT, EMPLOYEE, 4);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(20);

    await versions.setIfGreater(TENANT, EMPLOYEE, 6);
    expect(await redis.ttl(key)).toBeGreaterThan(PERMISSIONS_VERSION_TTL_SECONDS - 30);
  });

  it('a lost write self-heals: after the lifetime expires the next fill restores the database version', async () => {
    const key = `pv:${TENANT}:${EMPLOYEE}`;
    // The cache holds 6 while the database holds 7: the post-commit write of 7 was lost.
    await versions.setIfGreater(TENANT, EMPLOYEE, 6);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(6);
    // Fast-forward the lifetime: the key expires on its own, as it would after 300 s.
    await redis.pExpire(key, 50);
    await sleep(120);
    expect(await versions.get(TENANT, EMPLOYEE)).toBeNull();
    // The middleware sees a miss, reloads 7 from the database and fills it.
    await versions.setIfGreater(TENANT, EMPLOYEE, 7);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(7);
  });

  it('keeps versions of different employees apart and gives them a bounded lifetime', async () => {
    await versions.setIfGreater(TENANT, EMPLOYEE, 1);
    await versions.setIfGreater(TENANT, OTHER_EMPLOYEE, 2);
    expect(await versions.get(TENANT, EMPLOYEE)).toBe(1);
    expect(await versions.get(TENANT, OTHER_EMPLOYEE)).toBe(2);
    expect(await redis.ttl(`pv:${TENANT}:${EMPLOYEE}`)).toBeGreaterThan(0);
  });
});
