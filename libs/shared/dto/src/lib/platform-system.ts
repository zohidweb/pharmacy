/*
 * REST contract of the operator screens «Дашборд», «Статистика», «Уведомления», «Журнал действий»,
 * «Настройки платформы», «Профиль» and the sidebar counters. Shapes only (ADR-0015).
 * Event texts are not sent as prose: the server sends a kind + parameters and the client renders
 * them in the interface language (RU/TJ).
 */
import type { Page, StoreMode, SyncSchedule } from './platform-tenants.js';
import type { OperatorProfile } from './operator-auth.js';

// ── Sidebar counters and dashboard ────────────────────────────────────────────────────────

/** GET /platform/attention-counts */
export interface AttentionCounts {
  serviceRequests: number;
  expiringLicenses: number;
  unreadNotifications: number;
}

export interface DashboardSummary {
  tenants: number;
  activeTenants: number;
  cloudStores: number;
  offlineStores: number;
  /** Current month, without VAT. */
  accruedMinor: number;
  attention: {
    overdueInvoices: number;
    expiringKeys: number;
    serviceRequests: number;
    staleSync: number;
  };
}

export type EventKind =
  | 'invoice_overdue'
  | 'key_expiring'
  | 'key_revoked'
  | 'service_requested'
  | 'sync_stale'
  | 'payment_recorded'
  | 'update_available';

/** Where an event or a queue item leads in the admin. */
export type EventTarget =
  | { screen: 'tenant'; id: string }
  | { screen: 'store'; id: string }
  | { screen: 'billing' }
  | { screen: 'services' }
  | { screen: 'licenses' }
  | { screen: 'installations' };

export interface EventParams {
  tenantName?: string;
  storeName?: string;
  invoiceNumber?: string;
  serviceName?: string;
  amountMinor?: number;
  days?: number;
  version?: string;
}

export interface OperatorQueueItem {
  id: string;
  kind: EventKind;
  params: EventParams;
  target: EventTarget;
  at: string;
}

/** GET /platform/dashboard */
export interface DashboardResponse {
  summary: DashboardSummary;
  /** Daily sales of all tenants for the last 14 days. */
  sales: Array<{ date: string; salesMinor: number }>;
  queue: OperatorQueueItem[];
}

// ── Usage statistics ──────────────────────────────────────────────────────────────────────

export interface UsageKpi {
  receipts: number;
  salesMinor: number;
  averageReceiptMinor: number;
  activeCashiers: number;
}

export interface UsageStoreRow {
  storeId: string;
  storeName: string;
  mode: StoreMode;
  receipts: number;
  salesMinor: number;
  averageReceiptMinor: number;
  /** Last receipt (cloud) or last successful sync (offline). */
  lastActivityAt: string | null;
}

export interface UsageTenantRow extends Omit<
  UsageStoreRow,
  'storeId' | 'storeName' | 'mode'
> {
  tenantId: string;
  tenantName: string;
  stores: UsageStoreRow[];
}

/** GET /platform/usage-stats?period&tenantId */
export interface UsageStatsResponse {
  period: string;
  kpi: UsageKpi;
  rows: UsageTenantRow[];
}

// ── Notifications and announcements ───────────────────────────────────────────────────────

export type NotificationTopic = 'billing' | 'keys' | 'services' | 'sync';

export interface PlatformNotification {
  id: string;
  topic: NotificationTopic;
  kind: EventKind;
  params: EventParams;
  target: EventTarget;
  createdAt: string;
  read: boolean;
}

/** GET /platform/notifications?topic&limit&offset */
export interface NotificationListResponse extends Page<PlatformNotification> {
  counts: Record<'all' | NotificationTopic, number>;
  unread: number;
}

export type AnnouncementScope = 'all' | 'cloud' | 'offline';
export type AnnouncementStatus = 'scheduled' | 'published' | 'cancelled';

export interface Announcement {
  id: string;
  title: string;
  text: string;
  startsAt: string;
  endsAt: string;
  scope: AnnouncementScope;
  status: AnnouncementStatus;
}

/** POST /platform/announcements — shown to tenants in the client product. */
export interface CreateAnnouncementRequest {
  title: string;
  text: string;
  startsAt: string;
  endsAt: string;
  scope: AnnouncementScope;
}

/** GET/PUT /operator/me/notification-preferences — what the bell shows. */
export type NotificationPreferences = Record<NotificationTopic, boolean>;

// ── Operators' audit log ──────────────────────────────────────────────────────────────────

export type OperatorActionType =
  'company' | 'payment' | 'key' | 'service' | 'impersonation' | 'settings';

export interface OperatorAuditEntry {
  id: string;
  at: string;
  operatorId: string;
  operatorName: string;
  type: OperatorActionType;
  /** Company, store or "platform" the action was about. */
  targetLabel: string;
  description: string;
}

/** GET /platform/operator-audit-log?operatorId&type&from&to&limit&offset — read only. */
export interface OperatorAuditQuery {
  operatorId?: string;
  type?: OperatorActionType;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ── Platform settings and the operator team ───────────────────────────────────────────────

export interface PlatformSettings {
  pricePerStoreMinor: number;
  vatRatePercent: number;
  prorateByDays: boolean;
  keyExpiryNoticeDays: number;
  defaultSyncSchedule: SyncSchedule;
  acceptLegacyVersionSync: boolean;
  supplier: {
    name: string;
    inn: string;
    bankAccount: string;
    paymentPurposeTemplate: string;
  };
}

export type OperatorStatus = 'active' | 'disabled';

export interface PlatformOperator extends OperatorProfile {
  lastLoginAt: string | null;
  status: OperatorStatus;
}

/** POST /platform/operators — the first-login credentials are handed over in person. */
export interface CreateOperatorRequest {
  fullName: string;
  login: string;
}

// ── Profile of the signed-in operator ─────────────────────────────────────────────────────

export interface OperatorMe extends OperatorProfile {
  phone: string;
  position: string;
  locale: 'ru' | 'tg';
  lastLoginAt: string | null;
  impersonationReminder: boolean;
}

/** PATCH /operator/me */
export interface UpdateMeRequest {
  fullName: string;
  phone: string;
  position: string;
  locale: 'ru' | 'tg';
  impersonationReminder: boolean;
}

/**
 * POST /operator/me/password and POST /me/password — ends all other sessions (ADR-0008). Errors of
 * POST /me/password: 422 `invalid_current_password` with `errors: [{ field: 'currentPassword',
 * code: 'invalid_current_password' }]` (not 401: ADR-0015 reserves 401 for a lost session), 422
 * `password_policy`, 403 `fresh_auth_required`, 429 `login_locked` (5 wrong current passwords per
 * 15 minutes per employee).
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface OperatorSessionInfo {
  id: string;
  /** Browser and OS from the user agent. */
  device: string;
  lastSeenAt: string;
  current: boolean;
}

export interface OperatorActivityItem {
  id: string;
  at: string;
  description: string;
}
