/*
 * Thin API client (ADR-0015, ось 2б): fetch to the same origin (/api/v1, cookie session),
 * X-Correlation-Id on every request, timeout, RFC 7807 problem+json → typed ApiError.
 * Response bodies and personal data are never logged. During UI development without apps/api
 * the transport is swapped for in-memory mocks (./mocks, NEXT_PUBLIC_API_MOCKS=true), or only the
 * routes apps/api does not serve yet go to them (NEXT_PUBLIC_API_MOCKS=partial).
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
import { reportRequest } from './connectivity';

const API_BASE = '/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export interface ApiFieldError {
  field: string;
  code: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine code from problem+json `code` (or "network" / "timeout" / "aborted" / "unexpected"). */
    readonly code: string,
    readonly correlationId: string,
    readonly errors: ApiFieldError[] = [],
  ) {
    super(`API error ${status} ${code}`);
    this.name = 'ApiError';
  }
}

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
    // cancelled by the caller (navigation, refetch) — not a connection failure
    if (options.signal?.aborted)
      throw new ApiError(0, 'aborted', correlationId);
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
 * Routes apps/api already serves (spec 2026-10-06-owner-stores, section 6): in the `partial` mocks
 * mode they go to the API, every other route to the mocks;
 * binding a terminal has no route in this client.
 */
export const REAL_API_ROUTES: ReadonlySet<ApiRouteKey> = new Set<ApiRouteKey>([
  'sessions.create',
  'sessions.current',
  'sessions.selectStore',
  'sessions.delete',
  'activations.create',
  'me.get',
  'me.update',
  'me.changePassword',
  'me.changePin',
  'me.terminals',
  'terminals.current',
  'terminals.unbind',
  'terminalSessions.create',
  'stores.overview',
  'stores.create',
  'stores.update',
  'legalEntities.list',
  'legalEntities.create',
  'legalEntities.update',
  'sessions.confirm',
  'employees.list',
  'employees.get',
  'employees.create',
  'employees.update',
  'employees.resetPassword',
  'employees.setStatus',
  'employees.setPin',
  'roles.list',
  'roles.create',
  'roles.update',
  'terminals.list',
  'catalog.list',
  'catalog.get',
  'catalog.create',
  'catalog.update',
  'catalog.status',
  'catalog.references',
  'catalog.categories',
  'catalog.createCategory',
  'catalog.updateCategory',
  'catalog.categoryStatus',
  'prices.list',
  'prices.get',
  'prices.update',
  'discountRules.list',
  'discountRules.create',
  'discountRules.update',
  'settings.markups',
  'settings.updateMarkups',
  'stock.list',
  'stock.products',
  'stock.productBatches',
  'suppliers.options',
  'suppliers.list',
  'suppliers.get',
  'suppliers.create',
  'suppliers.update',
  'goodsReceipts.list',
  'goodsReceipts.get',
  'goodsReceipts.create',
  'goodsReceipts.update',
  'goodsReceipts.post',
  'goodsReceipts.unpost',
  'openingBalances.list',
  'openingBalances.get',
  'openingBalances.create',
  'openingBalances.update',
  'openingBalances.post',
  'openingBalances.unpost',
]);

/**
 * Routes shared by several kinds of documents that apps/api serves only for some of them: the
 * unposting check of goods receipts and opening balances is real, of the other documents — mocks.
 */
export const REAL_API_WHEN: Partial<
  Record<ApiRouteKey, (params: unknown) => boolean>
> = {
  'documents.unpostCheck': (params) =>
    ['goods-receipts', 'opening-balances'].includes(
      (params as { kind?: string } | undefined)?.kind ?? '',
    ),
};

/** Whether a request of the route goes to apps/api in the `partial` mode. */
export function isRealApiRequest(route: ApiRouteKey, params: unknown): boolean {
  const when = REAL_API_WHEN[route];
  return when ? when(params) : REAL_API_ROUTES.has(route);
}

/** The API for the routes it serves, the given mocks for the rest. */
export function partialTransport(mocks: ApiTransport): ApiTransport {
  return (route, options, correlationId) =>
    isRealApiRequest(route, (options as { params?: unknown }).params)
      ? fetchTransport(route, options, correlationId)
      : mocks(route, options, correlationId);
}

let transport: ApiTransport = fetchTransport;

/** Replaces the transport (mocks in development, fakes in tests). */
export function setApiTransport(next: ApiTransport): void {
  transport = next;
}

/** The request did not reach the server (outage or timeout), as opposed to an answer of it. */
export const isUnreachable = (error: unknown) =>
  error instanceof ApiError &&
  (error.code === 'network' || error.code === 'timeout');

export async function apiRequest<K extends ApiRouteKey>(
  route: K,
  options: ApiRequestOptions<K> = {},
): Promise<ApiResponse<K>> {
  try {
    const response = await transport(route, options, crypto.randomUUID());
    reportRequest(true);
    return response;
  } catch (error) {
    // any answer of the server, even an error, means it is reachable; a cancelled request says nothing
    if (!(error instanceof ApiError && error.code === 'aborted')) {
      reportRequest(!isUnreachable(error));
    }
    throw error;
  }
}
