import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  httpContext,
  problemOf,
  runAs,
  testPrincipal,
} from '../../../test/guards';
import { RequireFreshAuth } from './decorators';
import { FreshAuthGuard } from './fresh-auth.guard';

// Step-up (auth design 2026-10-02, section 7, guard 5): a @RequireFreshAuth() route needs a
// session opened with a password no longer than STEP_UP_MAX_AGE_SECONDS (900) ago.

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

class Controller {
  @RequireFreshAuth()
  changePassword(): void {
    return undefined;
  }

  plain(): void {
    return undefined;
  }
}

@RequireFreshAuth()
class FreshController {
  bind(): void {
    return undefined;
  }
}

describe('FreshAuthGuard', () => {
  const guard = new FreshAuthGuard(
    new Reflector(),
    new ConfigService({ STEP_UP_MAX_AGE_SECONDS: 900 }),
  );

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const run = (
    authenticatedAt: string,
    auth: 'password' | 'pin' = 'password',
    handler = 'changePassword',
  ) =>
    runAs(testPrincipal({ auth, authenticatedAt }), () =>
      guard.canActivate(httpContext(Controller, handler)),
    );

  it('ignores routes without @RequireFreshAuth()', () => {
    expect(run(minutesAgo(600), 'pin', 'plain')).toBe(true);
    expect(
      runAs(null, () => guard.canActivate(httpContext(Controller, 'plain'))),
    ).toBe(true);
  });

  it('lets a password session opened 10 minutes ago through', () => {
    expect(run(minutesAgo(10))).toBe(true);
  });

  it('lets a password session exactly at the limit through', () => {
    expect(run(minutesAgo(15))).toBe(true);
  });

  it('rejects a password session opened 16 minutes ago with 403 fresh_auth_required', async () => {
    await expect(problemOf(() => run(minutesAgo(16)))).resolves.toEqual({
      status: 403,
      code: 'fresh_auth_required',
    });
  });

  it('rejects a fresh PIN session with 403 fresh_auth_required', async () => {
    await expect(problemOf(() => run(minutesAgo(1), 'pin'))).resolves.toEqual({
      status: 403,
      code: 'fresh_auth_required',
    });
  });

  it('rejects an unparseable authenticatedAt', async () => {
    await expect(problemOf(() => run('not-a-date'))).resolves.toEqual({
      status: 403,
      code: 'fresh_auth_required',
    });
  });

  it('applies a class-level @RequireFreshAuth()', async () => {
    await expect(
      problemOf(() =>
        runAs(testPrincipal({ authenticatedAt: minutesAgo(20) }), () =>
          guard.canActivate(httpContext(FreshController, 'bind')),
        ),
      ),
    ).resolves.toEqual({ status: 403, code: 'fresh_auth_required' });
  });

  it('rejects a guest on a fresh-auth route with 401 unauthenticated', async () => {
    await expect(
      problemOf(() =>
        runAs(null, () =>
          guard.canActivate(httpContext(Controller, 'changePassword')),
        ),
      ),
    ).resolves.toEqual({ status: 401, code: 'unauthenticated' });
  });
});
