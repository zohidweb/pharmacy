export {
  ApiError,
  apiRequest,
  setApiTransport,
  type ApiFieldError,
  type ApiTransport,
} from './client';
export { apiRoutes, type ApiRouteKey } from './routes';
export { useApiErrorMessage } from './error-message';

/** True when the admin runs against in-memory mocks instead of apps/api. */
export const apiMocksEnabled = process.env.NEXT_PUBLIC_API_MOCKS === 'true';

/**
 * Loads the in-memory mock transport. The env variables are inlined at build time, so a build
 * without the flag folds the condition to `null` and emits no mock chunk.
 */
const mockModule =
  process.env.NEXT_PUBLIC_API_MOCKS === 'true' ||
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
