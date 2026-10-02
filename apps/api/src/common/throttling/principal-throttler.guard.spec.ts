import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import {
  httpContext,
  problemOf,
  runAs,
  testPrincipal,
  testResponse,
} from '../../../test/guards';
import { PrincipalThrottlerGuard } from './principal-throttler.guard';

// Throttling by principal (auth design 2026-10-02, section 7, guard 3): an employee is limited by
// employee id whatever the IP; a guest by IP. Over the limit: 429 too_many_requests.

class Controller {
  handle(): void {
    return undefined;
  }
}

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

const OTHER_EMPLOYEE = '0197a1b2-0000-7000-8000-00000000a0e2';

// Counts hits per key with a fixed limit; enough to observe which requests share a bucket.
class CountingStorage implements ThrottlerStorage {
  readonly hits = new Map<string, number>();

  async increment(
    key: string,
    _ttl: number,
    limit: number,
  ): Promise<ThrottlerStorageRecord> {
    const totalHits = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, totalHits);
    const isBlocked = totalHits > limit;
    return {
      totalHits,
      timeToExpire: 60,
      isBlocked,
      timeToBlockExpire: isBlocked ? 30 : 0,
    };
  }
}

async function setup(limit = 2) {
  const storage = new CountingStorage();
  const guard = new PrincipalThrottlerGuard(
    { throttlers: [{ name: 'default', ttl: 60_000, limit }] },
    storage,
    new Reflector(),
  );
  await guard.onModuleInit();
  return { guard, storage };
}

describe('PrincipalThrottlerGuard', () => {
  it('tracks an employee by employee id, not by IP', async () => {
    const { guard, storage } = await setup();
    const principal = testPrincipal();

    await runAs(principal, () =>
      guard.canActivate(
        httpContext(Controller, 'handle', { ip: '203.0.113.1' }),
      ),
    );
    await runAs(principal, () =>
      guard.canActivate(
        httpContext(Controller, 'handle', { ip: '203.0.113.2' }),
      ),
    );

    expect([...storage.hits.values()]).toEqual([2]);
  });

  it('gives two employees behind the same IP separate buckets', async () => {
    const { guard, storage } = await setup();

    await runAs(testPrincipal(), () =>
      guard.canActivate(
        httpContext(Controller, 'handle', { ip: '203.0.113.1' }),
      ),
    );
    await runAs(testPrincipal({ employeeId: OTHER_EMPLOYEE }), () =>
      guard.canActivate(
        httpContext(Controller, 'handle', { ip: '203.0.113.1' }),
      ),
    );

    expect([...storage.hits.values()]).toEqual([1, 1]);
  });

  it('tracks a guest by IP', async () => {
    const { guard, storage } = await setup();

    for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.9']) {
      await runAs(null, () =>
        guard.canActivate(httpContext(Controller, 'handle', { ip })),
      );
    }

    expect([...storage.hits.values()]).toEqual([2, 1]);
  });

  it('rejects over the limit with 429 too_many_requests and Retry-After', async () => {
    const { guard } = await setup(1);
    const response = testResponse();
    const context = () => httpContext(Controller, 'handle', {}, response);

    await expect(
      runAs(testPrincipal(), () => guard.canActivate(context())),
    ).resolves.toBe(true);
    await expect(
      problemOf(() =>
        runAs(testPrincipal(), () => guard.canActivate(context())),
      ),
    ).resolves.toEqual({ status: 429, code: 'too_many_requests' });
    expect(response.headers['Retry-After']).toBe(30);
  });
});
