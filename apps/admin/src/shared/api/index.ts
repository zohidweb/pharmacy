import { REAL_API_ROUTES } from './client';
import type { ApiRouteKey } from './routes';

export {
  ApiError,
  apiRequest,
  partialTransport,
  REAL_API_ROUTES,
  setApiTransport,
  type ApiFieldError,
  type ApiTransport,
} from './client';
export { apiRoutes, type ApiRouteKey } from './routes';
export { useApiErrorMessage } from './error-message';

/**
 * NEXT_PUBLIC_API_MOCKS: `true` — every route in in-memory mocks; `partial` — routes apps/api
 * serves (REAL_API_ROUTES) to the API, the rest to the mocks; unset — everything to apps/api.
 */
export const apiMocksMode: 'all' | 'partial' | 'off' =
  process.env.NEXT_PUBLIC_API_MOCKS === 'true'
    ? 'all'
    : process.env.NEXT_PUBLIC_API_MOCKS === 'partial'
      ? 'partial'
      : 'off';

/** True when any route runs against in-memory mocks. */
export const apiMocksEnabled = apiMocksMode !== 'off';

/**
 * Whether a route answers in this build: every route with the full mocks (and in tests, which run
 * against them); otherwise only the routes apps/api serves. Screens hide sections without an API.
 */
export function isApiRouteAvailable(route: ApiRouteKey): boolean {
  return (
    apiMocksMode === 'all' ||
    process.env.NODE_ENV === 'test' ||
    REAL_API_ROUTES.has(route)
  );
}

/**
 * Loads the in-memory mock transport. The env variables are inlined at build time, so a build
 * without the flag folds the condition to `null` and emits no mock chunk.
 */
const mockModule =
  process.env.NEXT_PUBLIC_API_MOCKS === 'true' ||
  process.env.NEXT_PUBLIC_API_MOCKS === 'partial' ||
  process.env.NODE_ENV === 'test'
    ? () => import('./mocks')
    : null;

export function loadMockTransport() {
  if (!mockModule) {
    return Promise.reject(new Error('API mocks are disabled'));
  }
  return mockModule().then((module) => module.mockTransport);
}

/** Restores the mock data set (tests and the dev catalog only). */
export async function resetApiMocks(): Promise<void> {
  if (!mockModule) return;
  (await mockModule()).resetMockDb();
}
