import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  httpContext,
  problemOf,
  runAs,
  TEST_STORE_1,
  TEST_STORE_2,
  testPrincipal,
  type TestRequest,
} from '../../../test/guards';
import type { EmployeePrincipal } from '../../common/context/request-context';
import { Authenticated, Public } from '../../common/guards/decorators';
import type { TenantDatabase, TenantTransaction } from '../../core/database';
import type { AuditService } from '../audit/audit.service';
import { RequirePermission } from './decorators';
import { PermissionsGuard } from './permissions.guard';

// PermissionsGuard (ADR-0018 p. 1, 3, 5, 9; auth design 2026-10-02, section 7, guard 4): deny by
// default, the permission must be in the session snapshot, the request's store must be in the
// scope (a PIN session: the terminal's store only), every 403 is audited as access.denied.

class Controller {
  @Public()
  open(): void {
    return undefined;
  }

  @Authenticated()
  profile(): void {
    return undefined;
  }

  undeclared(): void {
    return undefined;
  }

  @RequirePermission('catalog:view')
  catalog(): void {
    return undefined;
  }

  @RequirePermission('inventory:post')
  postInventory(): void {
    return undefined;
  }

  @RequirePermission('pos:view', { storeParam: 'storeId' })
  storeByParam(): void {
    return undefined;
  }

  @RequirePermission('pos:view', { storeQuery: 'store' })
  storeByQuery(): void {
    return undefined;
  }

  @RequirePermission('pos:view', { storeBody: 'storeId' })
  storeByBody(): void {
    return undefined;
  }
}

@RequirePermission('catalog:view')
class CatalogController {
  list(): void {
    return undefined;
  }

  @Authenticated()
  mine(): void {
    return undefined;
  }

  @RequirePermission('inventory:post')
  post(): void {
    return undefined;
  }
}

@Public()
class PublicController {
  open(): void {
    return undefined;
  }

  @RequirePermission('inventory:post')
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
}

const TRX = { trx: true } as unknown as TenantTransaction;

function setup() {
  const append = jest.fn<Promise<void>, Parameters<AuditService['append']>>(
    async () => undefined,
  );
  const tenantTransaction = jest.fn(
    async (work: (trx: TenantTransaction) => Promise<unknown>) => work(TRX),
  );
  const guard = new PermissionsGuard(
    new Reflector(),
    { tenantTransaction } as unknown as TenantDatabase,
    { append } as unknown as AuditService,
  );
  const run = (
    handler: string,
    principal: EmployeePrincipal | null = testPrincipal(),
    request: TestRequest = {},
    controller: new () => object = Controller,
  ) =>
    runAs(principal, () =>
      guard.canActivate(httpContext(controller, handler, request)),
    );
  return { guard, append, tenantTransaction, run };
}

const forbidden = { status: 403, code: 'forbidden' };

describe('PermissionsGuard', () => {
  it('lets @Public() through, even for a guest', async () => {
    const { run, append } = setup();
    await expect(run('open', null)).resolves.toBe(true);
    expect(append).not.toHaveBeenCalled();
  });

  it('lets @Authenticated() with a principal through without any catalog permission', async () => {
    const { run } = setup();
    await expect(
      run('profile', testPrincipal({ permissions: [] })),
    ).resolves.toBe(true);
  });

  it('rejects a guest on a non-public route with 401 and writes no audit', async () => {
    const { run, append } = setup();
    await expect(problemOf(() => run('catalog', null))).resolves.toEqual({
      status: 401,
      code: 'unauthenticated',
    });
    await expect(problemOf(() => run('profile', null))).resolves.toEqual({
      status: 401,
      code: 'unauthenticated',
    });
    expect(append).not.toHaveBeenCalled();
  });

  it('denies a route without @RequirePermission, @Authenticated and @Public (deny by default)', async () => {
    const { run, append, tenantTransaction } = setup();
    await expect(problemOf(() => run('undeclared'))).resolves.toEqual(
      forbidden,
    );
    expect(tenantTransaction).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(TRX, {
      action: 'access.denied',
      details: { permission: null, reason: 'no_permission_declared' },
    });
  });

  it('lets a principal with the permission through', async () => {
    const { run, append } = setup();
    await expect(run('catalog')).resolves.toBe(true);
    expect(append).not.toHaveBeenCalled();
  });

  it('denies a missing permission with 403 and an access.denied audit event', async () => {
    const { run, append } = setup();
    await expect(problemOf(() => run('postInventory'))).resolves.toEqual(
      forbidden,
    );
    expect(append).toHaveBeenCalledWith(TRX, {
      action: 'access.denied',
      details: { permission: 'inventory:post', reason: 'missing_permission' },
    });
  });

  describe('class-level metadata', () => {
    it('applies a class-level @RequirePermission', async () => {
      const { run } = setup();
      await expect(
        run('list', testPrincipal(), {}, CatalogController),
      ).resolves.toBe(true);
      await expect(
        problemOf(() =>
          run(
            'list',
            testPrincipal({ permissions: ['pos:view'] }),
            {},
            CatalogController,
          ),
        ),
      ).resolves.toEqual(forbidden);
    });

    it('a handler-level @Authenticated overrides the class permission', async () => {
      const { run } = setup();
      await expect(
        run('mine', testPrincipal({ permissions: [] }), {}, CatalogController),
      ).resolves.toBe(true);
    });

    it('a handler-level @RequirePermission overrides the class permission', async () => {
      const { run } = setup();
      await expect(
        problemOf(() => run('post', testPrincipal(), {}, CatalogController)),
      ).resolves.toEqual(forbidden);
    });
  });

  describe('nearest level wins (class @Public never overrides a handler marker)', () => {
    it('a @Public() class still lets its unmarked handler through', async () => {
      const { run } = setup();
      await expect(run('open', null, {}, PublicController)).resolves.toBe(true);
    });

    it('a handler @RequirePermission in a @Public() class rejects a guest with 401', async () => {
      const { run, append } = setup();
      await expect(
        problemOf(() => run('guarded', null, {}, PublicController)),
      ).resolves.toEqual({ status: 401, code: 'unauthenticated' });
      expect(append).not.toHaveBeenCalled();
    });

    it('a handler @RequirePermission in a @Public() class denies a principal without it', async () => {
      const { run, append } = setup();
      await expect(
        problemOf(() => run('guarded', testPrincipal(), {}, PublicController)),
      ).resolves.toEqual(forbidden);
      expect(append).toHaveBeenCalledWith(TRX, {
        action: 'access.denied',
        details: { permission: 'inventory:post', reason: 'missing_permission' },
      });
      await expect(
        run(
          'guarded',
          testPrincipal({ permissions: ['inventory:post'] }),
          {},
          PublicController,
        ),
      ).resolves.toBe(true);
    });

    it('a handler @Authenticated in a @Public() class rejects a guest with 401', async () => {
      const { run } = setup();
      await expect(
        problemOf(() => run('profile', null, {}, PublicController)),
      ).resolves.toEqual({ status: 401, code: 'unauthenticated' });
    });

    it('a handler @Public in a @RequirePermission class is public', async () => {
      const { run, append } = setup();
      await expect(run('open', null, {}, GuardedController)).resolves.toBe(
        true,
      );
      expect(append).not.toHaveBeenCalled();
    });
  });

  describe('store scope', () => {
    const listScope = testPrincipal({ storeScope: [TEST_STORE_1] });

    it('lets a store in the list scope through', async () => {
      const { run } = setup();
      await expect(
        run('storeByParam', listScope, { params: { storeId: TEST_STORE_1 } }),
      ).resolves.toBe(true);
    });

    it('denies a storeParam outside the scope with 403 and audits the store', async () => {
      const { run, append } = setup();
      await expect(
        problemOf(() =>
          run('storeByParam', listScope, { params: { storeId: TEST_STORE_2 } }),
        ),
      ).resolves.toEqual(forbidden);
      expect(append).toHaveBeenCalledWith(TRX, {
        action: 'access.denied',
        storeId: TEST_STORE_2,
        details: { permission: 'pos:view', reason: 'store_out_of_scope' },
      });
    });

    it('lets any store through with scope all', async () => {
      const { run } = setup();
      await expect(
        run('storeByParam', testPrincipal({ storeScope: 'all' }), {
          params: { storeId: TEST_STORE_2 },
        }),
      ).resolves.toBe(true);
    });

    it('checks storeQuery and storeBody', async () => {
      const { run } = setup();
      await expect(
        run('storeByQuery', listScope, { query: { store: TEST_STORE_1 } }),
      ).resolves.toBe(true);
      await expect(
        problemOf(() =>
          run('storeByQuery', listScope, { query: { store: TEST_STORE_2 } }),
        ),
      ).resolves.toEqual(forbidden);
      await expect(
        run('storeByBody', listScope, {
          method: 'POST',
          body: { storeId: TEST_STORE_1 },
        }),
      ).resolves.toBe(true);
      await expect(
        problemOf(() =>
          run('storeByBody', listScope, {
            method: 'POST',
            body: { storeId: TEST_STORE_2 },
          }),
        ),
      ).resolves.toEqual(forbidden);
    });

    it.each([
      ['a missing param', 'storeByParam', {}],
      ['a missing query value', 'storeByQuery', { query: {} }],
      [
        'a repeated query value',
        'storeByQuery',
        { query: { store: [TEST_STORE_1, TEST_STORE_1] } },
      ],
      ['a missing body', 'storeByBody', { method: 'POST' }],
      [
        'a non-string body value',
        'storeByBody',
        { method: 'POST', body: { storeId: 42 } },
      ],
      ['an empty value', 'storeByParam', { params: { storeId: '' } }],
    ])(
      'denies %s with 403 (scope option set, no value)',
      async (_, handler, request) => {
        const { run, append } = setup();
        await expect(
          problemOf(() =>
            run(
              handler,
              testPrincipal({ storeScope: 'all' }),
              request as TestRequest,
            ),
          ),
        ).resolves.toEqual(forbidden);
        expect(append).toHaveBeenCalledWith(TRX, {
          action: 'access.denied',
          details: { permission: 'pos:view', reason: 'store_missing' },
        });
      },
    );

    it('does not put a store id that is not a UUID into the audit store column', async () => {
      const { run, append } = setup();
      await expect(
        problemOf(() =>
          run('storeByParam', listScope, { params: { storeId: 'not-a-uuid' } }),
        ),
      ).resolves.toEqual(forbidden);
      expect(append).toHaveBeenCalledWith(TRX, {
        action: 'access.denied',
        details: { permission: 'pos:view', reason: 'store_out_of_scope' },
      });
    });

    describe('PIN session', () => {
      const pin = testPrincipal({
        auth: 'pin',
        storeScope: [TEST_STORE_1, TEST_STORE_2],
        currentStoreId: TEST_STORE_1,
        terminalId: '0197a1b2-0000-7000-8000-00000000a0f1',
      });

      it('lets the terminal store through', async () => {
        const { run } = setup();
        await expect(
          run('storeByParam', pin, { params: { storeId: TEST_STORE_1 } }),
        ).resolves.toBe(true);
      });

      it('denies another store of the scope with 403', async () => {
        const { run, append } = setup();
        await expect(
          problemOf(() =>
            run('storeByParam', pin, { params: { storeId: TEST_STORE_2 } }),
          ),
        ).resolves.toEqual(forbidden);
        expect(append).toHaveBeenCalledWith(TRX, {
          action: 'access.denied',
          storeId: TEST_STORE_2,
          details: { permission: 'pos:view', reason: 'store_out_of_scope' },
        });
      });

      it('denies any store when the PIN session has no current store, even with scope all', async () => {
        const { run } = setup();
        await expect(
          problemOf(() =>
            run(
              'storeByParam',
              testPrincipal({
                auth: 'pin',
                storeScope: 'all',
                currentStoreId: null,
              }),
              { params: { storeId: TEST_STORE_1 } },
            ),
          ),
        ).resolves.toEqual(forbidden);
      });
    });
  });

  describe('audit failure', () => {
    let logError: jest.SpyInstance;

    beforeEach(() => {
      logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      logError.mockRestore();
    });

    it('still throws 403 when the audit write fails and logs without the error text', async () => {
      const { run, append } = setup();
      const failure = Object.assign(
        new Error('value "sensitive input" is invalid'),
        {
          code: '22P02',
        },
      );
      append.mockRejectedValueOnce(failure);

      await expect(problemOf(() => run('postInventory'))).resolves.toEqual(
        forbidden,
      );

      expect(logError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(logError.mock.calls[0]);
      expect(logged).toContain('22P02');
      expect(logged).not.toContain('sensitive input');
    });

    it('still throws 403 when the transaction itself fails', async () => {
      const { run, tenantTransaction } = setup();
      tenantTransaction.mockRejectedValueOnce(new Error('connection refused'));

      await expect(problemOf(() => run('postInventory'))).resolves.toEqual(
        forbidden,
      );
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });
});
