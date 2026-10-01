/*
 * Map of the REST routes the admin calls (ADR-0015, ось 2б): one place that ties a route key to
 * its method, path and DTO types from @pharmacy/shared-dto. Paths are relative to /api/v1.
 */
import type {
  OperatorLoginRequest,
  OperatorSession,
} from '@pharmacy/shared-dto';

interface RouteDef<Body, Response> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Phantom fields: carry the types only. */
  body?: Body;
  response?: Response;
}

function route<Body = undefined, Response = void>(
  method: RouteDef<Body, Response>['method'],
  path: string,
): RouteDef<Body, Response> {
  return { method, path };
}

export const apiRoutes = {
  'operator.sessions.create': route<OperatorLoginRequest, OperatorSession>(
    'POST',
    '/operator/sessions',
  ),
  'operator.sessions.current': route<undefined, OperatorSession>(
    'GET',
    '/operator/sessions/current',
  ),
  'operator.sessions.delete': route<undefined, void>(
    'DELETE',
    '/operator/sessions/current',
  ),
} as const;

export type ApiRouteKey = keyof typeof apiRoutes;

type RouteOf<K extends ApiRouteKey> = (typeof apiRoutes)[K];
export type ApiBody<K extends ApiRouteKey> =
  RouteOf<K> extends RouteDef<infer B, unknown> ? B : never;
export type ApiResponse<K extends ApiRouteKey> =
  RouteOf<K> extends RouteDef<unknown, infer R> ? R : never;
