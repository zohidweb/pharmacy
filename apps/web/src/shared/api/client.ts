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
const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface ApiFieldError {
  field: string;
  code: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /**
     * Machine code from problem+json `code` (or "network" / "timeout" / "aborted" / "gateway" / "unexpected").
     */
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
  /** Extra headers of the request (not part of the idempotent body). */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Instead of the default 15 s — a long request, e.g. loading a file (2 min). */
  timeoutMs?: number;
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
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
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
        ...options.headers,
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
    // apps/api answers every error as problem+json: a 5xx without it came from the reverse proxy (or the dev server)
    // in its place — the API is stopped or restarting, not reached
    if (
      response.status >= 500 &&
      !response.headers.get('Content-Type')?.includes(PROBLEM_CONTENT_TYPE)
    ) {
      throw new ApiError(response.status, 'gateway', correlationId);
    }
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
 * mode they go to the API, every other route to the mocks.
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
  'terminals.bind',
  'terminals.current',
  'terminals.unbind',
  'terminalSessions.create',
  'stores.overview',
  'services.list',
  'serviceRequests.create',
  'serviceRequests.withdraw',
  'billing.get',
  'billing.invoice',
  'stores.create',
  'stores.update',
  'stores.closingPreview',
  'stores.close',
  'stores.cancelClosing',
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
  // customer returns (spec 2026-10-13-customer-returns)
  'receipts.returnable',
  'returns.salesSearch',
  'returns.create',
  'returns.list',
  'settings.returns',
  'settings.updateReturns',
  // the owner cabinet, PR 1 (spec 2026-10-14-owner-cabinet)
  'settings.get',
  'settings.update',
  'dashboard.get',
  'notifications.list',
  'notifications.readAll',
  'auditLog.list',
  'reports.get',
  'expenses.list',
  'expenses.create',
  'expenses.update',
  'expenses.delete',
  'stock.list',
  'stock.reorder',
  'navCounters.get',
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
  // loading data from a file (spec 2026-10-20-data-import)
  'catalogImports.check',
  'catalogImports.apply',
  'openingBalanceImports.check',
  'openingBalanceImports.apply',
  'supplierImports.check',
  'supplierImports.apply',
  'suppliers.pay',
  'purchaseOrders.list',
  'purchaseOrders.get',
  'purchaseOrders.create',
  'purchaseOrders.update',
  'purchaseOrders.confirm',
  'purchaseOrders.open',
  'purchaseOrders.deficit',
  'writeOffs.list',
  'writeOffs.get',
  'writeOffs.create',
  'writeOffs.update',
  'writeOffs.post',
  'writeOffs.unpost',
  'supplierReturns.list',
  'supplierReturns.get',
  'supplierReturns.create',
  'supplierReturns.update',
  'supplierReturns.post',
  'supplierReturns.unpost',
  'transfers.overview',
  'transfers.get',
  'transfers.create',
  'transfers.update',
  'transfers.send',
  'transfers.recall',
  'transfers.cancel',
  'transfers.accept',
  'transferRequests.get',
  'transferRequests.create',
  'transferRequests.update',
  'transferRequests.delete',
  'transferRequests.send',
  'transferRequests.reject',
  'stockCounts.list',
  'stockCounts.get',
  'stockCounts.version',
  'stockCounts.start',
  'stockCounts.save',
  'stockCounts.addEntry',
  'stockCounts.deleteEntry',
  'stockCounts.addFoundLine',
  'stockCounts.updateFoundLine',
  'stockCounts.deleteFoundLine',
  'stockCounts.post',
  'stockCounts.unpost',
  'stockCounts.cancel',
  // the unposting check of every kind that has one: goods receipts, opening balances, write-offs, stock counts and
  // supplier returns
  'documents.unpostCheck',
  // the POS: shift and sale (spec 2026-10-13-pos-shift-sale)
  'catalog.snapshot',
  'receipts.create',
  'heldReceipts.list',
  'heldReceipts.create',
  'heldReceipts.delete',
  'shifts.current',
  'shifts.open',
  'shifts.cashMovement',
  'shifts.close',
  'shifts.zReport',
  'shifts.list',
  'shifts.details',
  'shifts.forceClose',
  'deployment.get',
  // the announcements of the platform (spec 2026-10-19-operator-notifications)
  'announcements.list',
  'health.get',
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

/**
 * apps/api did not answer — an outage, a timeout or a gateway answer in its place (the API stopped or restarting behind
 * the reverse proxy) — as opposed to an answer of the API, an error one too. Whether a request that went was processed
 * is unknown: only idempotent operations are repeated.
 */
export const isUnreachable = (error: unknown) =>
  error instanceof ApiError &&
  (error.code === 'network' ||
    error.code === 'timeout' ||
    error.code === 'gateway');

/**
 * The server has no session for the request (401 `unauthenticated`): it timed out, was ended or blocked. A failed
 * sign-in answers other codes (`invalid_credentials`, `invalid_pin`, `invalid_code`) and a step-up asks with 403, so
 * neither ends the session here (security review 2026-10-22, F2).
 */
export const isSessionEnded = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 401 &&
  error.code === 'unauthenticated';

export async function apiRequest<K extends ApiRouteKey>(
  route: K,
  options: ApiRequestOptions<K> = {},
): Promise<ApiResponse<K>> {
  try {
    const response = await transport(route, options, crypto.randomUUID());
    reportRequest(true);
    return response;
  } catch (error) {
    // any answer of the API, even an error, means it is reachable (a gateway answer in its place does not); a
    // cancelled request says nothing
    if (!(error instanceof ApiError && error.code === 'aborted')) {
      reportRequest(!isUnreachable(error));
    }
    throw error;
  }
}
