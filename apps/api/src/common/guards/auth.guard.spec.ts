import { Reflector } from '@nestjs/core';
import {
  httpContext,
  problemOf,
  runAs,
  testPrincipal,
} from '../../../test/guards';
import { AuthGuard } from './auth.guard';
import { Authenticated, Public } from './decorators';

@Public()
class PublicController {
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
