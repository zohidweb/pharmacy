import { Reflector } from '@nestjs/core';
import { httpContext } from '../../../test/guards';
import { RequirePermission } from '../../app/auth/decorators';
import { Authenticated, Public } from './decorators';
import { resolveRouteAccess } from './route-access';

// resolveRouteAccess: the nearest level wins; several markers on one level resolve to the
// strictest; no marker anywhere is 'none' (deny by default).

@Public()
class PublicController {
  open(): void {
    return undefined;
  }

  @RequirePermission('catalog:view', { storeParam: 'storeId' })
  guarded(): void {
    return undefined;
  }

  @Authenticated()
  profile(): void {
    return undefined;
  }
}

@RequirePermission('inventory:post')
class GuardedController {
  @Public()
  open(): void {
    return undefined;
  }

  inherited(): void {
    return undefined;
  }
}

class PlainController {
  plain(): void {
    return undefined;
  }

  @Public()
  @RequirePermission('catalog:view')
  both(): void {
    return undefined;
  }

  @Public()
  @Authenticated()
  publicAndAuthenticated(): void {
    return undefined;
  }
}

const resolve = (controller: new () => object, handler: string) =>
  resolveRouteAccess(new Reflector(), httpContext(controller, handler));

describe('resolveRouteAccess', () => {
  it('applies the class marker to an unmarked handler', () => {
    expect(resolve(PublicController, 'open')).toEqual({ kind: 'public' });
    expect(resolve(GuardedController, 'inherited')).toEqual({
      kind: 'permission',
      permission: 'inventory:post',
    });
  });

  it('a handler marker replaces a class @Public()', () => {
    expect(resolve(PublicController, 'guarded')).toEqual({
      kind: 'permission',
      permission: 'catalog:view',
      scope: { storeParam: 'storeId' },
    });
    expect(resolve(PublicController, 'profile')).toEqual({
      kind: 'authenticated',
    });
  });

  it('a handler @Public() replaces a class permission', () => {
    expect(resolve(GuardedController, 'open')).toEqual({ kind: 'public' });
  });

  it('is none without any marker', () => {
    expect(resolve(PlainController, 'plain')).toEqual({ kind: 'none' });
  });

  it('resolves several markers on one level to the strictest', () => {
    expect(resolve(PlainController, 'both')).toEqual({
      kind: 'permission',
      permission: 'catalog:view',
    });
    expect(resolve(PlainController, 'publicAndAuthenticated')).toEqual({
      kind: 'authenticated',
    });
  });
});
