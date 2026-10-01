/*
 * In-memory mock transport: answers the same routes and errors (problem codes) as apps/api will,
 * so screens are built against the real contract. The mock session lives in sessionStorage to
 * survive a reload in development. Enabled only by NEXT_PUBLIC_API_MOCKS=true.
 */
import type { OperatorSession } from '@pharmacy/shared-dto';
import { ApiError, type ApiTransport } from '../client';
import type { ApiBody, ApiResponse, ApiRouteKey } from '../routes';
import { demoOperator, demoOperatorPassword } from './fixtures';

const SESSION_KEY = 'pharmacy-admin-mock-session';
const LATENCY_MS = 300;

function readSession(): OperatorSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as OperatorSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: OperatorSession | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): the mock session lives only until reload
  }
}

type Handlers = {
  [K in ApiRouteKey]: (
    body: ApiBody<K>,
    correlationId: string,
  ) => ApiResponse<K>;
};

const handlers: Handlers = {
  'operator.sessions.create': (body, correlationId) => {
    if (
      body?.login.trim().toLowerCase() !== demoOperator.login ||
      body.password !== demoOperatorPassword
    ) {
      throw new ApiError(401, 'invalid_credentials', correlationId);
    }
    const session: OperatorSession = {
      operator: demoOperator,
      authenticatedAt: new Date().toISOString(),
    };
    writeSession(session);
    return session;
  },
  'operator.sessions.current': (_body, correlationId) => {
    const session = readSession();
    if (!session) throw new ApiError(401, 'unauthenticated', correlationId);
    return session;
  },
  'operator.sessions.delete': () => {
    writeSession(null);
  },
};

export const mockTransport: ApiTransport = async (
  route,
  options,
  correlationId,
) => {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (options.signal?.aborted) throw new ApiError(0, 'network', correlationId);
  const handler = handlers[route] as (
    body: ApiBody<typeof route>,
    id: string,
  ) => ApiResponse<typeof route>;
  return handler(options.body as ApiBody<typeof route>, correlationId);
};
