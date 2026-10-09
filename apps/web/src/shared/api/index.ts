import { REAL_API_ROUTES, REAL_API_WHEN } from './client';
import type { ApiRouteKey } from './routes';

export {
  ApiError,
  apiRequest,
  isUnreachable,
  partialTransport,
  REAL_API_ROUTES,
  setApiTransport,
  type ApiFieldError,
  type ApiTransport,
} from './client';
export {
  FreshAuthCancelled,
  freshAuthStore,
  isFreshAuthCancelled,
  withFreshAuth,
} from './fresh-auth';
export {
  apiRoutes,
  type ApiBody,
  type ApiResponse,
  type ApiRouteKey,
} from './routes';
export {
  isOnline,
  resetConnectivity,
  startConnectivity,
  subscribeConnectivity,
} from './connectivity';
export { apiFieldErrors, useApiErrorMessage } from './error-message';

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
 * against them); otherwise only the routes apps/api serves. Screens hide actions without an API.
 */
export function isApiRouteAvailable(route: ApiRouteKey): boolean {
  return (
    apiMocksMode === 'all' ||
    process.env.NODE_ENV === 'test' ||
    REAL_API_ROUTES.has(route) ||
    route in REAL_API_WHEN
  );
}

/**
 * Whether two routes answer from the same place (both apps/api or both mocks). In the `partial`
 * mode a screen offers a step that connects them only then: an id from the mocks is unknown to
 * apps/api (a purchase order of a real goods receipt, a payment of a real supplier).
 */
export function sameTransport(a: ApiRouteKey, b: ApiRouteKey): boolean {
  return (
    apiMocksMode !== 'partial' ||
    REAL_API_ROUTES.has(a) === REAL_API_ROUTES.has(b)
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

/** Restores the mock data set (tests only). */
export async function resetApiMocks(): Promise<void> {
  if (!mockModule) return;
  (await mockModule()).resetMockDb();
}

export type MockScenario =
  'impersonation' | 'unbound-terminal' | 'offline' | 'online' | 'no-shift';

/** Puts the mocks into a state that is hard to reach by clicking (tests only). */
export async function applyMockScenario(scenario: MockScenario): Promise<void> {
  if (!mockModule) return;
  const mocks = await mockModule();
  mocks.applyScenario(scenario);
}
