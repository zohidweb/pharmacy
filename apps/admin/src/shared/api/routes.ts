/*
 * Map of the REST routes the admin calls (ADR-0015, ось 2б): one place that ties a route key to
 * its method, path and DTO types from @pharmacy/shared-dto. Paths are relative to /api/v1.
 */
import type {
  Announcement,
  AttentionCounts,
  ChangePasswordRequest,
  CreateAnnouncementRequest,
  CreateOperatorRequest,
  DashboardResponse,
  NotificationListResponse,
  NotificationPreferences,
  NotificationTopic,
  OperatorActivityItem,
  OperatorAuditEntry,
  OperatorAuditQuery,
  OperatorMe,
  OperatorSessionInfo,
  PlatformOperator,
  PlatformSettings,
  UpdateMeRequest,
  UsageStatsResponse,
  BillingSummary,
  CancelPaymentRequest,
  GenerateInvoicesRequest,
  GenerateInvoicesResponse,
  InstallationFilter,
  InstallationListResponse,
  InvoiceDetails,
  InvoiceGenerationPreview,
  InvoiceListFilter,
  InvoiceListResponse,
  IssueLicenseRequest,
  LicenseListFilter,
  LicenseListItem,
  LicenseListResponse,
  LicenseSortKey,
  OfflineStoreOption,
  PaymentListItem,
  PlatformService,
  RecalculationPreview,
  RecordPaymentRequest,
  RejectServiceRequest,
  Release,
  RenewLicenseRequest,
  RevokeLicenseRequest,
  ScheduleUpdateRequest,
  ServiceRequestItem,
  UpdatePaymentRequest,
  UpsertServiceRequest,
  InstallationItem,
  BlockTenantRequest,
  CreateTenantRequest,
  CreateTenantResponse,
  IssueOwnerCodeResponse,
  ImpersonationHandoff,
  ImpersonationRequest,
  MigrateStoreToCloudRequest,
  OperatorLoginRequest,
  OperatorSession,
  AuditEntry,
  Page,
  StoreDetails,
  StoreSummary,
  TenantDetails,
  TenantInvoiceItem,
  TenantListQuery,
  TenantListResponse,
  TenantPaymentItem,
  TenantServiceItem,
  TenantStats,
  UpdateStoreLicenseSettingsRequest,
  UpdateStoreRequest,
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
  'operator.sessions.create': route<OperatorSession, OperatorLoginRequest>(
    'POST',
    () => '/operator/sessions',
  ),
  'operator.sessions.current': route<OperatorSession>(
    'GET',
    () => '/operator/sessions/current',
  ),
  'operator.sessions.delete': route<void>(
    'DELETE',
    () => '/operator/sessions/current',
  ),
  'operator.impersonations.create': route<
    ImpersonationHandoff,
    ImpersonationRequest
  >('POST', () => '/operator/impersonations'),

  'tenants.list': route<
    TenantListResponse,
    undefined,
    undefined,
    TenantListQuery
  >('GET', () => '/operator/tenants'),
  'tenants.create': route<CreateTenantResponse, CreateTenantRequest>(
    'POST',
    () => '/operator/tenants',
  ),
  'tenants.get': route<TenantDetails, undefined, { id: string }>(
    'GET',
    (p) => `/operator/tenants/${id(p)}`,
  ),
  'tenants.block': route<TenantDetails, BlockTenantRequest, { id: string }>(
    'POST',
    (p) => `/operator/tenants/${id(p)}/block`,
  ),
  'tenants.ownerCode': route<IssueOwnerCodeResponse, undefined, { id: string }>(
    'POST',
    (p) => `/operator/tenants/${id(p)}/owner-activation-codes`,
  ),
  'tenants.unblock': route<TenantDetails, undefined, { id: string }>(
    'POST',
    (p) => `/operator/tenants/${id(p)}/unblock`,
  ),
  'tenants.stores': route<StoreSummary[], undefined, { id: string }>(
    'GET',
    (p) => `/operator/tenants/${id(p)}/stores`,
  ),
  'tenants.invoices': route<TenantInvoiceItem[], undefined, { id: string }>(
    'GET',
    (p) => `/operator/tenants/${id(p)}/invoices`,
  ),
  'tenants.payments': route<TenantPaymentItem[], undefined, { id: string }>(
    'GET',
    (p) => `/operator/tenants/${id(p)}/payments`,
  ),
  'tenants.services': route<TenantServiceItem[], undefined, { id: string }>(
    'GET',
    (p) => `/operator/tenants/${id(p)}/services`,
  ),
  'tenants.stats': route<TenantStats, undefined, { id: string }>(
    'GET',
    (p) => `/operator/tenants/${id(p)}/stats`,
  ),
  'tenants.audit': route<
    Page<AuditEntry>,
    undefined,
    { id: string },
    { limit?: number; offset?: number }
  >('GET', (p) => `/operator/tenants/${id(p)}/audit-log`),

  'stores.get': route<StoreDetails, undefined, { id: string }>(
    'GET',
    (p) => `/operator/stores/${id(p)}`,
  ),
  'stores.update': route<StoreDetails, UpdateStoreRequest, { id: string }>(
    'PATCH',
    (p) => `/operator/stores/${id(p)}`,
  ),
  'stores.updateLicenseSettings': route<
    StoreDetails,
    UpdateStoreLicenseSettingsRequest,
    { id: string }
  >('PATCH', (p) => `/operator/stores/${id(p)}/license-settings`),
  'stores.requestSync': route<void, undefined, { id: string }>(
    'POST',
    (p) => `/operator/stores/${id(p)}/sync-requests`,
  ),
  'stores.migrateToCloud': route<
    StoreDetails,
    MigrateStoreToCloudRequest,
    { id: string }
  >('POST', (p) => `/operator/stores/${id(p)}/cloud-migrations`),
  'billing.summary': route<
    BillingSummary,
    undefined,
    undefined,
    { period?: string }
  >('GET', () => '/operator/billing/summary'),
  'invoices.list': route<
    InvoiceListResponse,
    undefined,
    undefined,
    { filter?: InvoiceListFilter; limit?: number; offset?: number }
  >('GET', () => '/operator/invoices'),
  'invoices.get': route<InvoiceDetails, undefined, { id: string }>(
    'GET',
    (p) => `/operator/invoices/${id(p)}`,
  ),
  'invoices.generationPreview': route<
    InvoiceGenerationPreview,
    undefined,
    undefined,
    { period: string }
  >('GET', () => '/operator/invoices/generation-preview'),
  'invoices.generate': route<GenerateInvoicesResponse, GenerateInvoicesRequest>(
    'POST',
    () => '/operator/invoices/generations',
  ),
  'invoices.recalculationPreview': route<
    RecalculationPreview,
    undefined,
    { id: string }
  >('GET', (p) => `/operator/invoices/${id(p)}/recalculation-preview`),
  'invoices.recalculate': route<InvoiceDetails, undefined, { id: string }>(
    'POST',
    (p) => `/operator/invoices/${id(p)}/recalculation`,
  ),
  'payments.list': route<
    Page<PaymentListItem>,
    undefined,
    undefined,
    { limit?: number; offset?: number }
  >('GET', () => '/operator/payments'),
  'payments.record': route<PaymentListItem, RecordPaymentRequest>(
    'POST',
    () => '/operator/payments',
  ),
  'payments.update': route<
    PaymentListItem,
    UpdatePaymentRequest,
    { id: string }
  >('PATCH', (p) => `/operator/payments/${id(p)}`),
  'payments.cancel': route<
    PaymentListItem,
    CancelPaymentRequest,
    { id: string }
  >('POST', (p) => `/operator/payments/${id(p)}/cancellation`),

  'services.list': route<PlatformService[]>('GET', () => '/operator/services'),
  'services.create': route<PlatformService, UpsertServiceRequest>(
    'POST',
    () => '/operator/services',
  ),
  'services.update': route<
    PlatformService,
    UpsertServiceRequest,
    { id: string }
  >('PUT', (p) => `/operator/services/${id(p)}`),
  'serviceRequests.list': route<ServiceRequestItem[]>(
    'GET',
    () => '/operator/service-requests',
  ),
  'serviceRequests.approve': route<void, undefined, { id: string }>(
    'POST',
    (p) => `/operator/service-requests/${id(p)}/approval`,
  ),
  'serviceRequests.reject': route<void, RejectServiceRequest, { id: string }>(
    'POST',
    (p) => `/operator/service-requests/${id(p)}/rejection`,
  ),

  'licenses.list': route<
    LicenseListResponse,
    undefined,
    undefined,
    {
      filter?: LicenseListFilter;
      sort?: LicenseSortKey;
      direction?: 'asc' | 'desc';
    }
  >('GET', () => '/operator/licenses'),
  'licenses.issue': route<LicenseListItem, IssueLicenseRequest>(
    'POST',
    () => '/operator/licenses',
  ),
  'licenses.renew': route<LicenseListItem, RenewLicenseRequest, { id: string }>(
    'POST',
    (p) => `/operator/licenses/${id(p)}/renewal`,
  ),
  'licenses.revoke': route<
    LicenseListItem,
    RevokeLicenseRequest,
    { id: string }
  >('POST', (p) => `/operator/licenses/${id(p)}/revocation`),
  'stores.offlineOptions': route<OfflineStoreOption[]>(
    'GET',
    () => '/operator/stores/offline-options',
  ),

  'installations.list': route<
    InstallationListResponse,
    undefined,
    undefined,
    { filter?: InstallationFilter }
  >('GET', () => '/operator/installations'),
  'installations.scheduleUpdate': route<
    InstallationItem,
    ScheduleUpdateRequest,
    { storeId: string }
  >(
    'POST',
    (p) =>
      `/operator/installations/${encodeURIComponent(p.storeId)}/update-plans`,
  ),
  'releases.list': route<Release[]>('GET', () => '/operator/releases'),
  'attention.counts': route<AttentionCounts>(
    'GET',
    () => '/operator/attention-counts',
  ),
  'dashboard.get': route<DashboardResponse>('GET', () => '/operator/dashboard'),
  'usage.stats': route<
    UsageStatsResponse,
    undefined,
    undefined,
    { period: string; tenantId?: string }
  >('GET', () => '/operator/usage-stats'),

  'notifications.list': route<
    NotificationListResponse,
    undefined,
    undefined,
    { topic?: NotificationTopic; limit?: number; offset?: number }
  >('GET', () => '/operator/notifications'),
  'notifications.readAll': route<void>(
    'POST',
    () => '/operator/notifications/read-all',
  ),
  'announcements.list': route<Announcement[]>(
    'GET',
    () => '/operator/announcements',
  ),
  'announcements.create': route<Announcement, CreateAnnouncementRequest>(
    'POST',
    () => '/operator/announcements',
  ),
  'announcements.cancel': route<Announcement, undefined, { id: string }>(
    'POST',
    (p) => `/operator/announcements/${id(p)}/cancellation`,
  ),
  'me.notificationPreferences': route<NotificationPreferences>(
    'GET',
    () => '/operator/me/notification-preferences',
  ),
  'me.updateNotificationPreferences': route<
    NotificationPreferences,
    NotificationPreferences
  >('PUT', () => '/operator/me/notification-preferences'),

  'operatorAudit.list': route<
    Page<OperatorAuditEntry>,
    undefined,
    undefined,
    OperatorAuditQuery
  >('GET', () => '/operator/operator-audit-log'),

  'settings.get': route<PlatformSettings>('GET', () => '/operator/settings'),
  'settings.update': route<PlatformSettings, PlatformSettings>(
    'PUT',
    () => '/operator/settings',
  ),
  'operators.list': route<PlatformOperator[]>(
    'GET',
    () => '/operator/operators',
  ),
  'operators.create': route<PlatformOperator, CreateOperatorRequest>(
    'POST',
    () => '/operator/operators',
  ),
  'operators.disable': route<PlatformOperator, undefined, { id: string }>(
    'POST',
    (p) => `/operator/operators/${id(p)}/deactivation`,
  ),

  'me.get': route<OperatorMe>('GET', () => '/operator/me'),
  'me.update': route<OperatorMe, UpdateMeRequest>(
    'PATCH',
    () => '/operator/me',
  ),
  'me.changePassword': route<void, ChangePasswordRequest>(
    'POST',
    () => '/operator/me/password',
  ),
  'me.sessions': route<OperatorSessionInfo[]>(
    'GET',
    () => '/operator/me/sessions',
  ),
  'me.endOtherSessions': route<void>(
    'DELETE',
    () => '/operator/me/sessions/others',
  ),
  'me.activity': route<OperatorActivityItem[]>(
    'GET',
    () => '/operator/me/activity',
  ),
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
