import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission } from '@pharmacy/shared-domain';

// The authenticated employee of a request, built once by the session middleware from the
// server-side session. Never derived from client input.
export interface EmployeePrincipal {
  readonly kind: 'employee';
  readonly tenantId: string;
  readonly employeeId: string;
  readonly sessionId: string;
  readonly auth: 'password' | 'pin';
  readonly authenticatedAt: string;
  readonly permissions: readonly Permission[];
  readonly storeScope: 'all' | readonly string[];
  readonly currentStoreId: string | null;
  readonly terminalId: string | null;
  readonly locale: 'ru' | 'tg';
}

// Per-request context, readable anywhere in the request without passing parameters. The data
// layer reads the tenant from here (requireTenantId -> set_config('app.tenant_id', ...)).
// tenantId is set only by server-side guards (session, license key), never from client input;
// it equals principal.tenantId, or is set by background jobs that have no principal.
// The stored context is deeply frozen (see runWithContext).
export interface RequestContext {
  readonly correlationId: string;
  readonly tenantId?: string;
  readonly principal: EmployeePrincipal | null;
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

export class UnauthenticatedError extends Error {
  constructor() {
    // Mapped to HTTP 401 by the exception filter (a later task).
    super('Authentication is required');
    this.name = 'UnauthenticatedError';
  }
}

export function requireTenantId(): string {
  const tenantId = getRequestContext()?.tenantId;
  if (!tenantId) throw new TenantContextMissingError();
  return tenantId;
}

export const getPrincipal = (): EmployeePrincipal | null =>
  getRequestContext()?.principal ?? null;

export function requirePrincipal(): EmployeePrincipal {
  const principal = getPrincipal();
  if (!principal) throw new UnauthenticatedError();
  return principal;
}

// Context data is plain JSON-like values (strings, arrays, objects, null), so a structural
// copy is enough; the copy is then frozen recursively, nested arrays included.
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(deepCopy) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepCopy(item)]),
    ) as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/**
 * Runs fn in a deeply frozen copy of the context — for the session middleware, background work
 * (queue workers, cron) and tests. The given object is neither frozen nor retained.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(deepFreeze(deepCopy(context)), fn);
}
