import { Reflector } from '@nestjs/core';
import {
  httpContext,
  problemOf,
  runAs,
  testPrincipal,
} from '../../../test/guards';
import { RequirePermission } from '../../app/auth/decorators';
import { AuthGuard } from './auth.guard';
import { Authenticated, Public } from './decorators';

// A class marker applies only to handlers without a marker of their own: the nearest level wins.
@Public()
class PublicController {
  open(): void {
    return undefined;
  }

  @RequirePermission('catalog:view')
  guarded(): void {
    return undefined;
  }

  @Authenticated()
  profile(): void {
    return undefined;
  }
}

@RequirePermission('catalog:view')
class GuardedController {
  @Public()
  open(): void {
    return undefined;
  }
}

class Controller {
  @Public()
  open(): void {
    return undefined;
  }

  @Authenticated()
  profile(): void {
    return undefined;
  }

  plain(): void {
    return undefined;
  }
}

describe('AuthGuard', () => {
  const guard = new AuthGuard(new Reflector());

  it('lets a @Public() handler through without a principal', () => {
    expect(
      runAs(null, () => guard.canActivate(httpContext(Controller, 'open'))),
    ).toBe(true);
  });

  it('lets a handler of a @Public() class through without a principal', () => {
    expect(
      runAs(null, () =>
        guard.canActivate(httpContext(PublicController, 'open')),
      ),
    ).toBe(true);
  });

  it.each(['guarded', 'profile'])(
    'rejects a guest on a %s handler of a @Public() class with 401 (class @Public never overrides a handler marker)',
    async (handler) => {
      await expect(
        problemOf(() =>
          runAs(null, () =>
            guard.canActivate(httpContext(PublicController, handler)),
          ),
        ),
      ).resolves.toEqual({ status: 401, code: 'unauthenticated' });
    },
  );

  it('lets a guest through a @Public() handler of a @RequirePermission class', () => {
    expect(
      runAs(null, () =>
        guard.canActivate(httpContext(GuardedController, 'open')),
      ),
    ).toBe(true);
  });

  it.each(['plain', 'profile'])(
    'rejects a guest on %s with 401 unauthenticated',
    async (handler) => {
      await expect(
        problemOf(() =>
          runAs(null, () =>
            guard.canActivate(httpContext(Controller, handler)),
          ),
        ),
      ).resolves.toEqual({ status: 401, code: 'unauthenticated' });
    },
  );

  it('rejects a request outside any request context with 401', async () => {
    await expect(
      problemOf(() => guard.canActivate(httpContext(Controller, 'plain'))),
    ).resolves.toEqual({ status: 401, code: 'unauthenticated' });
  });

  it('lets a principal through', () => {
    expect(
      runAs(testPrincipal(), () =>
        guard.canActivate(httpContext(Controller, 'plain')),
      ),
    ).toBe(true);
  });
});
