/*
 * Thin API client (ADR-0015, ось 2б): fetch to the same origin (/api/v1, cookie session),
 * X-Correlation-Id on every request, timeout, RFC 7807 problem+json → typed ApiError.
 * Response bodies and personal data are never logged. During UI development without apps/api
 * the transport is swapped for in-memory mocks (./mocks, NEXT_PUBLIC_API_MOCKS=true).
 */
import {
  apiRoutes,
  type ApiBody,
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

export interface ApiRequestOptions<K extends ApiRouteKey> {
  body?: ApiBody<K>;
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
  const { method, path } = apiRoutes[route];
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json, application/problem+json',
        'X-Correlation-Id': correlationId,
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
