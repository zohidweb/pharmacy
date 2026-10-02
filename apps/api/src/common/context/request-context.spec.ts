import {
  type EmployeePrincipal,
  getPrincipal,
  getRequestContext,
  requirePrincipal,
  requireTenantId,
  runWithContext,
  TenantContextMissingError,
  UnauthenticatedError,
} from './request-context';

const TENANT_A = '01900000-0000-7000-8000-00000000000a';
const TENANT_B = '01900000-0000-7000-8000-00000000000b';

const makePrincipal = (
  overrides: Partial<EmployeePrincipal> = {},
): EmployeePrincipal => ({
  kind: 'employee',
  tenantId: TENANT_A,
  employeeId: '01900000-0000-7000-8000-0000000000e1',
  sessionId: 'session-0001',
  auth: 'password',
  authenticatedAt: '2026-10-02T08:00:00.000Z',
  permissions: ['catalog:view', 'pos:create'],
  storeScope: ['01900000-0000-7000-8000-0000000000s1'],
  currentStoreId: null,
  terminalId: null,
  locale: 'ru',
  ...overrides,
});

describe('request context', () => {
  it('requireTenantId throws TenantContextMissingError outside a context', () => {
    expect(getRequestContext()).toBeUndefined();
    expect(() => requireTenantId()).toThrow(TenantContextMissingError);
    expect(() => requireTenantId()).toThrow('Tenant context is missing');
  });

  it('requireTenantId throws inside a context without a tenant', () => {
    expect(() =>
      runWithContext({ correlationId: 'corr-0001', principal: null }, () =>
        requireTenantId(),
      ),
    ).toThrow(TenantContextMissingError);
  });

  it('returns the tenant set by runWithContext', () => {
    const tenantId = runWithContext(
      { correlationId: 'corr-0001', tenantId: TENANT_A, principal: null },
      () => requireTenantId(),
    );
    expect(tenantId).toBe(TENANT_A);
  });

  it('keeps the context across awaits', async () => {
    const tenantId = await runWithContext(
      { correlationId: 'corr-0001', tenantId: TENANT_A, principal: null },
      async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return requireTenantId();
      },
    );
    expect(tenantId).toBe(TENANT_A);
  });

  it('runWithContext isolates nested contexts', () => {
    const outer = {
      correlationId: 'corr-outer',
      tenantId: TENANT_A,
      principal: null,
    };
    runWithContext(outer, () => {
      const inner = runWithContext(
        { correlationId: 'corr-inner', tenantId: TENANT_B, principal: null },
        () => requireTenantId(),
      );
      expect(inner).toBe(TENANT_B);
      expect(getRequestContext()).toEqual({
        correlationId: 'corr-outer',
        tenantId: TENANT_A,
        principal: null,
      });
      expect(requireTenantId()).toBe(TENANT_A);
    });
  });

  it('context is deeply frozen', () => {
    runWithContext(
      {
        correlationId: 'corr-0001',
        tenantId: TENANT_A,
        principal: makePrincipal(),
      },
      () => {
        const context = getRequestContext();
        const principal = getPrincipal();
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(principal)).toBe(true);
        expect(() =>
          Object.assign(context as object, { tenantId: TENANT_B }),
        ).toThrow(TypeError);
        expect(() =>
          Object.assign(principal as object, { employeeId: 'x' }),
        ).toThrow(TypeError);
        expect(() =>
          (principal?.permissions as unknown as string[]).push('x'),
        ).toThrow(TypeError);
        expect(() =>
          (principal?.storeScope as unknown as string[]).push('x'),
        ).toThrow(TypeError);
        expect(requireTenantId()).toBe(TENANT_A);
      },
    );
  });

  it('runWithContext stores a copy and leaves the given object untouched', () => {
    const principal = makePrincipal();
    const context = {
      correlationId: 'corr-0001',
      tenantId: TENANT_A,
      principal,
    };
    runWithContext(context, () => {
      expect(getRequestContext()).not.toBe(context);
      expect(getPrincipal()).not.toBe(principal);
    });
    expect(Object.isFrozen(context)).toBe(false);
    expect(Object.isFrozen(principal)).toBe(false);
    expect(Object.isFrozen(principal.permissions)).toBe(false);
    context.tenantId = TENANT_B;
    expect(context.tenantId).toBe(TENANT_B);
  });

  it('a storeScope of "all" is kept as is', () => {
    runWithContext(
      {
        correlationId: 'corr-0001',
        principal: makePrincipal({ storeScope: 'all' }),
      },
      () => expect(getPrincipal()?.storeScope).toBe('all'),
    );
  });

  describe('principal', () => {
    it('getPrincipal returns null outside a context and without a principal', () => {
      expect(getPrincipal()).toBeNull();
      runWithContext({ correlationId: 'corr-0001', principal: null }, () =>
        expect(getPrincipal()).toBeNull(),
      );
    });

    it('requirePrincipal returns the principal', () => {
      const principal = runWithContext(
        {
          correlationId: 'corr-0001',
          tenantId: TENANT_A,
          principal: makePrincipal(),
        },
        () => requirePrincipal(),
      );
      expect(principal).toEqual(makePrincipal());
    });

    it('requirePrincipal throws UnauthenticatedError without a principal', () => {
      expect(() => requirePrincipal()).toThrow(UnauthenticatedError);
      expect(() =>
        runWithContext({ correlationId: 'corr-0001', principal: null }, () =>
          requirePrincipal(),
        ),
      ).toThrow(UnauthenticatedError);
      expect(new UnauthenticatedError().name).toBe('UnauthenticatedError');
    });
  });
});
