/*
 * Map of the REST routes the client product calls (ADR-0015, ось 2б): one place that ties a route key
 * to its method, path and DTO types from @pharmacy/shared-dto. Paths are relative to /api/v1.
 */
import type {
  BoundTerminal,
  CashMovementRequest,
  CatalogSnapshot,
  CloseShiftRequest,
  CreatedReceipt,
  CreatedReturn,
  CreateReceiptRequest,
  CreateReturnRequest,
  DeploymentInfo,
  HeldReceipt,
  HoldReceiptRequest,
  OpenShiftRequest,
  ReturnableReceipt,
  ReturnListResponse,
  ReturnReason,
  SaleSearchItem,
  Shift,
  ZReport,
  ChangePasswordRequest,
  ChangePinRequest,
  DashboardPeriod,
  EmployeeLoginRequest,
  EmployeeMe,
  EmployeeSession,
  MyTerminal,
  PinLoginRequest,
  SelectStoreRequest,
  SyncStatus,
  TenantDashboard,
  TenantNotificationListResponse,
  UpdateEmployeeMeRequest,
} from '@pharmacy/shared-dto';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type QueryValue = string | number | boolean | undefined;

interface RouteDef<Params, Query, Body, Response> {
  method: Method;
  path: (params: Params) => string;
  /** Phantom fields: carry the types only. */
  params?: Params;
  query?: Query;
  body?: Body;
  response?: Response;
}

function route<
  Response,
  Body = undefined,
  Params = undefined,
  Query = undefined,
>(
  method: Method,
  path: (params: Params) => string,
): RouteDef<Params, Query, Body, Response> {
  return { method, path };
}

const id = (params: { id: string }) => encodeURIComponent(params.id);

export const apiRoutes = {
  'sessions.create': route<EmployeeSession, EmployeeLoginRequest>(
    'POST',
    () => '/sessions',
  ),
  'sessions.current': route<EmployeeSession>('GET', () => '/sessions/current'),
  'sessions.selectStore': route<EmployeeSession, SelectStoreRequest>(
    'PUT',
    () => '/sessions/current/store',
  ),
  'sessions.delete': route<void>('DELETE', () => '/sessions/current'),

  'terminals.current': route<BoundTerminal>('GET', () => '/terminals/current'),
  'terminals.unbind': route<void, undefined, { id: string }>(
    'DELETE',
    (p) => `/terminals/${id(p)}`,
  ),
  'terminalSessions.create': route<EmployeeSession, PinLoginRequest>(
    'POST',
    () => '/terminal-sessions',
  ),

  'sync.status': route<SyncStatus>('GET', () => '/sync/status'),

  'dashboard.get': route<
    TenantDashboard,
    undefined,
    undefined,
    { period: DashboardPeriod }
  >('GET', () => '/dashboard'),

  'notifications.list': route<
    TenantNotificationListResponse,
    undefined,
    undefined,
    { limit?: number; offset?: number }
  >('GET', () => '/notifications'),
  'notifications.readAll': route<void>('POST', () => '/notifications/read-all'),

  'me.get': route<EmployeeMe>('GET', () => '/me'),
  'me.update': route<EmployeeMe, UpdateEmployeeMeRequest>('PATCH', () => '/me'),
  'me.changePassword': route<void, ChangePasswordRequest>(
    'POST',
    () => '/me/password',
  ),
  'me.changePin': route<void, ChangePinRequest>('POST', () => '/me/pin'),
  'me.terminals': route<MyTerminal[]>('GET', () => '/me/terminals'),

  'health.get': route<{ status: string }>('GET', () => '/health'),
  'deployment.get': route<DeploymentInfo>('GET', () => '/deployment'),

  'catalog.snapshot': route<
    CatalogSnapshot,
    undefined,
    { storeId: string },
    { sinceVersion?: number }
  >('GET', (p) => `/stores/${encodeURIComponent(p.storeId)}/catalog-snapshot`),

  'receipts.create': route<CreatedReceipt, CreateReceiptRequest>(
    'POST',
    () => '/receipts',
  ),
  'heldReceipts.list': route<HeldReceipt[], undefined, { storeId: string }>(
    'GET',
    (p) => `/stores/${encodeURIComponent(p.storeId)}/held-receipts`,
  ),
  'heldReceipts.create': route<HeldReceipt, HoldReceiptRequest>(
    'POST',
    () => '/held-receipts',
  ),
  'heldReceipts.delete': route<void, undefined, { id: string }>(
    'DELETE',
    (p) => `/held-receipts/${id(p)}`,
  ),

  'shifts.current': route<Shift>('GET', () => '/shifts/current'),
  'shifts.open': route<Shift, OpenShiftRequest>('POST', () => '/shifts'),
  'shifts.cashMovement': route<Shift, CashMovementRequest, { id: string }>(
    'POST',
    (p) => `/shifts/${id(p)}/cash-movements`,
  ),
  'shifts.close': route<ZReport, CloseShiftRequest, { id: string }>(
    'POST',
    (p) => `/shifts/${id(p)}/closure`,
  ),

  'receipts.returnable': route<
    ReturnableReceipt,
    undefined,
    undefined,
    { number: string }
  >('GET', () => '/receipts/returnable'),
  'returns.salesSearch': route<
    SaleSearchItem[],
    undefined,
    undefined,
    { query: string; date: string }
  >('GET', () => '/returns/sales-search'),
  'returns.create': route<CreatedReturn, CreateReturnRequest>(
    'POST',
    () => '/returns',
  ),
  'returns.list': route<
    ReturnListResponse,
    undefined,
    undefined,
    { reason?: ReturnReason; limit?: number; offset?: number }
  >('GET', () => '/returns'),
} as const;

export type ApiRouteKey = keyof typeof apiRoutes;

type RouteOf<K extends ApiRouteKey> = (typeof apiRoutes)[K];
type Parts<K extends ApiRouteKey> =
  RouteOf<K> extends RouteDef<infer P, infer Q, infer B, infer R>
    ? { params: P; query: Q; body: B; response: R }
    : never;
export type ApiParams<K extends ApiRouteKey> = Parts<K>['params'];
export type ApiQuery<K extends ApiRouteKey> = Parts<K>['query'];
export type ApiBody<K extends ApiRouteKey> = Parts<K>['body'];
export type ApiResponse<K extends ApiRouteKey> = Parts<K>['response'];

/** Serializes defined query values; booleans and numbers as strings. */
export function toQueryString(
  query: Record<string, QueryValue> | undefined,
): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
