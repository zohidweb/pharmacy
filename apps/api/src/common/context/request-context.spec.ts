import {
  getRequestContext,
  requireTenantId,
  runWithContext,
  TenantContextMissingError,
} from './request-context';

const TENANT_A = '01900000-0000-7000-8000-00000000000a';
const TENANT_B = '01900000-0000-7000-8000-00000000000b';

describe('request context', () => {
  it('requireTenantId throws TenantContextMissingError outside a context', () => {
    expect(getRequestContext()).toBeUndefined();
    expect(() => requireTenantId()).toThrow(TenantContextMissingError);
    expect(() => requireTenantId()).toThrow('Tenant context is missing');
  });

  it('requireTenantId throws inside a context without a tenant', () => {
    expect(() =>
      runWithContext({ correlationId: 'corr-0001' }, () => requireTenantId()),
    ).toThrow(TenantContextMissingError);
  });

  it('returns the tenant set by runWithContext', () => {
    const tenantId = runWithContext(
      { correlationId: 'corr-0001', tenantId: TENANT_A },
      () => requireTenantId(),
    );
    expect(tenantId).toBe(TENANT_A);
  });

  it('keeps the context across awaits', async () => {
    const tenantId = await runWithContext(
      { correlationId: 'corr-0001', tenantId: TENANT_A },
      async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return requireTenantId();
      },
    );
    expect(tenantId).toBe(TENANT_A);
  });

  it('runWithContext isolates nested contexts', () => {
    const outer = { correlationId: 'corr-outer', tenantId: TENANT_A };
    runWithContext(outer, () => {
      const inner = runWithContext(
        { correlationId: 'corr-inner', tenantId: TENANT_B },
        () => {
          // A mutation of the inner context must not reach the outer one.
          Object.assign(getRequestContext() ?? {}, { tenantId: TENANT_B });
          return requireTenantId();
        },
      );
      expect(inner).toBe(TENANT_B);
      expect(getRequestContext()).toEqual({
        correlationId: 'corr-outer',
        tenantId: TENANT_A,
      });
      expect(requireTenantId()).toBe(TENANT_A);
    });
    expect(outer).toEqual({ correlationId: 'corr-outer', tenantId: TENANT_A });
  });

  it('runWithContext copies the given object', () => {
    const context = { correlationId: 'corr-0001', tenantId: TENANT_A };
    runWithContext(context, () => {
      Object.assign(getRequestContext() ?? {}, { tenantId: TENANT_B });
    });
    expect(context.tenantId).toBe(TENANT_A);
  });
});
