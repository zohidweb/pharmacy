import type {
  ApiBody,
  ApiParams,
  ApiQuery,
  ApiResponse,
  ApiRouteKey,
} from '../routes';

export interface MockRequest<K extends ApiRouteKey> {
  params: ApiParams<K>;
  query: ApiQuery<K>;
  body: ApiBody<K>;
  correlationId: string;
  /** The Idempotency-Key header of the request, if any. */
  idempotencyKey?: string;
}

export type MockHandlers = {
  [K in ApiRouteKey]: (request: MockRequest<K>) => ApiResponse<K>;
};
