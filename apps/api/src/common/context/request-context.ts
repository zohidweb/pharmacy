import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request context, readable anywhere in the request without passing parameters. The data
// layer reads the tenant from here (requireTenantId -> set_config('app.tenant_id', ...)).
// tenantId is set only by server-side guards (session, license key), never from client input.
export interface RequestContext {
  correlationId: string;
  tenantId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined =>
  requestContextStorage.getStore();

export class TenantContextMissingError extends Error {
  constructor() {
    // A programming error (500), never an unscoped query.
    super('Tenant context is missing');
    this.name = 'TenantContextMissingError';
  }
}

export function requireTenantId(): string {
  const tenantId = getRequestContext()?.tenantId;
  if (!tenantId) throw new TenantContextMissingError();
  return tenantId;
}

/** Runs fn in a fresh copy of the context — for background work (queue workers, cron) and tests. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run({ ...context }, fn);
}
