/*
 * REST contract of the operator screens «Дашборд», «Статистика», «Уведомления», «Журнал действий»,
 * «Настройки платформы», «Профиль» and the sidebar counters. Shapes only (ADR-0015).
 * Event texts are not sent as prose: the server sends a kind + parameters and the client renders
 * them in the interface language (RU/TJ).
 */
import type { Page, StoreMode, SyncSchedule } from './platform-tenants.js';
import type { OperatorProfile } from './operator-auth.js';
import type { UiLocale } from './tenant-auth.js';

// ── Sidebar counters and dashboard ────────────────────────────────────────────────────────

/** GET /operator/attention-counts */
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

/** GET /operator/dashboard */
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

/** GET /operator/usage-stats?period&tenantId */
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

/** GET /operator/notifications?topic&limit&offset */
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

/** POST /operator/announcements — shown to tenants in the client product. */
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

/**
 * Kind of an event — the filter of the operator audit log. `access`: sign-ins, activation and
 * refusals; `company`: networks; the rest come with their modules (payments, keys, services,
 * platform settings and the team).
 */
export type OperatorActionType =
  'access' | 'company' | 'payment' | 'key' | 'service' | 'settings';

/** Who acted: an operator, or a platform job (`create-operator`). */
export type OperatorAuditActor =
  | { kind: 'operator'; operatorId: string; name: string }
  | { kind: 'system'; job: string };

/** A named record an event refers to. */
export interface OperatorAuditRef {
  id: string;
  name: string;
}

/**
 * One event of platform_audit_log (data model 06). The screen words it from `action` and `details`
 * in RU/TJ; the server sends no prose.
 */
export interface OperatorAuditEntry {
  id: string;
  at: string;
  actor: OperatorAuditActor;
  type: OperatorActionType;
  /** Event code: `tenant.blocked`, `auth.operator-login-failed`, `access.denied`… */
  action: string;
  /** The company the event concerns. */
  tenant: OperatorAuditRef | null;
  /** The store the event concerns. */
  store: OperatorAuditRef | null;
  /** The operator the event concerns (a sign-in, an activation, a code for a new operator). */
  operator: OperatorAuditRef | null;
  /** Codes for the wording (`permission`, `reason`): never secrets, identifier values or addresses. */
  details: Record<string, string>;
}

/**
 * GET /operator/operator-audit-log — read only, newest first. `operatorId` — who acted; `from` and
 * `to` — calendar dates (YYYY-MM-DD) of the platform time zone, both included.
 */
export interface OperatorAuditQuery {
  operatorId?: string;
  tenantId?: string;
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

/**
 * GET /operator/operators; 200 from POST /operator/operators/{id}/deactivation — the operator's
 * sessions end at once. Errors of the deactivation: 404, 409 `cannot_disable_self`, 409
 * `already_disabled`, 403 `fresh_auth_required`.
 */
export interface PlatformOperator extends OperatorProfile {
  lastLoginAt: string | null;
  status: OperatorStatus;
}

/**
 * POST /operator/operators — a new operator with a one-time code for the first sign-in, handed
 * over in person; the operator sets the password on «Первый вход». Errors: 400 `validation_failed`
 * (`login` — `email_format`: the login is a work e-mail), 409 `login_taken` (field `login`), 403
 * `fresh_auth_required`.
 */
export interface CreateOperatorRequest {
  fullName: string;
  login: string;
}

/** 201 from POST /operator/operators. The code is shown once: only its hash is stored. */
export interface CreateOperatorResponse {
  operator: PlatformOperator;
  activationCode: string;
  activationCodeExpiresAt: string;
}

/**
 * 201 from POST /operator/operators/{id}/activation-codes — a new one-time code (a lost or expired
 * code, a forgotten password): the old code stops working, a password stays until the new code is
 * used. 404, 409 `operator_disabled`, 403 `fresh_auth_required`.
 */
export interface IssueOperatorCodeResponse {
  activationCode: string;
  activationCodeExpiresAt: string;
}

// ── Profile of the signed-in operator ─────────────────────────────────────────────────────

/** GET /operator/me */
export interface OperatorMe extends OperatorProfile {
  locale: UiLocale;
  lastLoginAt: string | null;
}

/** PATCH /operator/me — the name and the interface language. */
export interface UpdateMeRequest {
  fullName: string;
  locale: UiLocale;
}

/**
 * POST /operator/me/password and POST /me/password — ends all other sessions (ADR-0008). Errors:
 * 422 `invalid_current_password` with `errors: [{ field: 'currentPassword', code:
 * 'invalid_current_password' }]` (not 401: ADR-0015 reserves 401 for a lost session), 422
 * `password_policy`, 429 `login_locked` (5 wrong current passwords per 15 minutes per person).
 * POST /me/password also answers 403 `fresh_auth_required`; the operator route does not: the
 * current password is the confirmation.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** GET /operator/me/sessions — the signed-in operator's sessions, the current one first. */
export interface OperatorSessionInfo {
  /** Opaque id of the session (not the session token or its id). */
  id: string;
  /** Browser and OS from the user agent; empty when they are not recognized. */
  device: string;
  lastSeenAt: string;
  current: boolean;
}
