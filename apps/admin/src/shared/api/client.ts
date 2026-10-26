/*
 * Thin API client (ADR-0015, ось 2б): fetch to the same origin (/api/v1, cookie session),
 * X-Correlation-Id on every request, timeout, RFC 7807 problem+json → typed ApiError.
 * Response bodies and personal data are never logged. During UI development without apps/api
 * the transport is swapped for in-memory mocks (./mocks, NEXT_PUBLIC_API_MOCKS=true), or for the
 * API with mocks for the routes it does not serve yet (NEXT_PUBLIC_API_MOCKS=partial).
 */
import {
  apiRoutes,
  toQueryString,
  type ApiBody,
  type ApiParams,
  type ApiQuery,
  type ApiResponse,
  type ApiRouteKey,
} from './routes';

const API_BASE = '/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export interface ApiFieldError {
  field: string;
  code: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine code from problem+json `code` (or "network" / "timeout" / "unexpected"). */
    readonly code: string,
    readonly correlationId: string,
    readonly errors: ApiFieldError[] = [],
  ) {
    super(`API error ${status} ${code}`);
    this.name = 'ApiError';
  }
}

/**
 * The server has no session for the request (401 `unauthenticated`): it timed out, was ended or blocked. A failed
 * sign-in answers other codes (`invalid_credentials`, `invalid_pin`, `invalid_code`) and a step-up asks with 403, so
 * neither ends the session here (security review 2026-10-22, F2).
 */
export const isSessionEnded = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 401 &&
  error.code === 'unauthenticated';

export interface ApiRequestOptions<K extends ApiRouteKey> {
  params?: ApiParams<K>;
  query?: ApiQuery<K>;
  body?: ApiBody<K>;
  /** Sent as Idempotency-Key: the same key for retries of one user action. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export type ApiTransport = <K extends ApiRouteKey>(
  route: K,
  options: ApiRequestOptions<K>,
  correlationId: string,
) => Promise<ApiResponse<K>>;

interface ProblemDetails {
  status?: number;
  code?: string;
  errors?: ApiFieldError[];
}

const fetchTransport: ApiTransport = async (route, options, correlationId) => {
  const definition = apiRoutes[route] as unknown as {
    method: string;
    path: (params: unknown) => string;
  };
  const { method } = definition;
  const url = `${API_BASE}${definition.path(options.params)}${toQueryString(
    options.query as
      Record<string, string | number | boolean | undefined> | undefined,
  )}`;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json, application/problem+json',
        'X-Correlation-Id': correlationId,
        ...(options.idempotencyKey && {
          'Idempotency-Key': options.idempotencyKey,
        }),
        ...(options.body !== undefined && {
          'Content-Type': 'application/json',
        }),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError(
      0,
      timeout.aborted ? 'timeout' : 'network',
      correlationId,
    );
  }

  if (!response.ok) {
    const problem: ProblemDetails = await response
      .json()
      .catch(() => ({}) as ProblemDetails);
    throw new ApiError(
      response.status,
      problem.code ?? 'unexpected',
      response.headers.get('X-Correlation-Id') ?? correlationId,
      problem.errors ?? [],
    );
  }

  if (response.status === 204) {
    return undefined as ApiResponse<typeof route>;
  }
  return (await response.json()) as ApiResponse<typeof route>;
};

/**
 * Routes apps/api already serves (spec 2026-10-05-tenants-module, section 7): in the `partial`
 * mocks mode they go to the API, every other route to the mocks.
 */
export const REAL_API_ROUTES: ReadonlySet<ApiRouteKey> = new Set<ApiRouteKey>([
  'operator.activations.create',
  'operator.sessions.create',
  'operator.sessions.current',
  'operator.sessions.delete',
  'operatorAudit.list',
  'operators.list',
  'operators.create',
  'operators.issueCode',
  'operators.disable',
  'me.get',
  'me.update',
  'me.changePassword',
  'me.sessions',
  'me.endOtherSessions',
  'me.activity',
  'settings.get',
  'settings.update',
  'services.list',
  'services.create',
  'services.update',
  'serviceRequests.list',
  'serviceRequests.approve',
  'serviceRequests.reject',
  'tenants.services',
  'tenants.addService',
  'tenantServices.list',
  'tenantServices.provide',
  'tenantServices.unprovide',
  'tenantServices.update',
  'tenantServices.cancel',
  'attention.counts',
  'billing.summary',
  'invoices.list',
  'invoices.get',
  'invoices.generationPreview',
  'invoices.generate',
  'invoices.recalculationPreview',
  'invoices.recalculate',
  'payments.list',
  'payments.record',
  'payments.update',
  'payments.cancel',
  'tenants.invoices',
  'tenants.payments',
  'tenants.discounts',
  'tenants.addDiscount',
  'discounts.shorten',
  'discounts.remove',
  'tenants.list',
  'tenants.get',
  'tenants.stores',
  'tenants.create',
  'tenants.ownerCode',
  'tenants.block',
  'tenants.update',
  'tenants.unblock',
  // the store card (spec 2026-10-23-admin-store-card-tenant-log)
  'stores.get',
  // the operator dashboard and the statistics (spec 2026-10-19-admin-dashboard-stats)
  'dashboard.get',
  'usage.stats',
  'tenants.stats',
  // the operator notifications and the announcements (spec 2026-10-19-operator-notifications)
  'notifications.list',
  'notifications.readAll',
  'announcements.list',
  'announcements.create',
  'announcements.cancel',
  'me.notificationPreferences',
  'me.updateNotificationPreferences',
]);

/** The API for the routes it serves, the given mocks for the rest. */
export function partialTransport(mocks: ApiTransport): ApiTransport {
  return (route, options, correlationId) =>
    REAL_API_ROUTES.has(route)
      ? fetchTransport(route, options, correlationId)
      : mocks(route, options, correlationId);
}

let transport: ApiTransport = fetchTransport;

/** Replaces the transport (mocks in development, fakes in tests). */
export function setApiTransport(next: ApiTransport): void {
  transport = next;
}

export function apiRequest<K extends ApiRouteKey>(
  route: K,
  options: ApiRequestOptions<K> = {},
): Promise<ApiResponse<K>> {
  return transport(route, options, crypto.randomUUID());
}
