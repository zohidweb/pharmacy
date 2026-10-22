/*
 * REST contract of the operator screens «Дашборд», «Статистика», «Уведомления», «Журнал действий»,
 * «Настройки платформы», «Профиль» and the sidebar counters. Shapes only (ADR-0015).
 * Event texts are not sent as prose: the server sends a kind + parameters and the client renders
 * them in the interface language (RU/TJ).
 */
import type { Page, StoreMode } from './platform-tenants.js';
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
  /** Open pharmacies (status active or closing) of the cloud and offline modes; warehouses are not counted. */
  cloudStores: number;
  offlineStores: number;
  /** The invoices of the last invoiced period, with VAT (spec 2026-10-19-admin-dashboard-stats, D12). */
  accruedMinor: number;
  /** YYYY-MM of `accruedMinor`; null — no invoices yet. */
  accruedPeriod: string | null;
  /** The number of items of each kind of the operator queue (D13), all of them — the queue shows 20. */
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

/**
 * GET /operator/dashboard (`platform:view`). The figures of the receipts come from the statistics
 * marts the networks refresh in their own context (spec 2026-10-19-admin-dashboard-stats).
 */
export interface DashboardResponse {
  summary: DashboardSummary;
  /**
   * The sum of the receipts of all networks by business date for the 14 days to today (Dushanbe),
   * returns not subtracted (D8); a day without sales is 0.
   */
  sales: Array<{ date: string; salesMinor: number }>;
  /** Overdue invoices, expiring keys, stale offline stores, pending requests — at most 20 (D13). */
  queue: OperatorQueueItem[];
  /** The oldest refresh of the marts of the networks shown (D7); null — none refreshed yet. */
  asOf: string | null;
}

// ── Usage statistics ──────────────────────────────────────────────────────────────────────

export interface UsageKpi {
  receipts: number;
  /** The sum of the receipts, returns of customers not subtracted (D8). */
  salesMinor: number;
  /** salesMinor / receipts rounded to a diram; 0 without receipts. */
  averageReceiptMinor: number;
  /** Different cashiers with a receipt in the month, summed over the networks (D9). */
  activeCashiers: number;
}

export interface UsageStoreRow {
  storeId: string;
  storeName: string;
  mode: StoreMode;
  receipts: number;
  salesMinor: number;
  averageReceiptMinor: number;
  /**
   * The last receipt ever (cloud) or the last successful sync (offline); of a network — the latest of
   * its stores; null — neither (D10).
   */
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

/**
 * GET /operator/usage-stats?period&tenantId (`platform:view`). `period` — YYYY-MM from 2026-01 to the
 * current month, otherwise 400 `validation_failed`; an unknown `tenantId` — 404.
 */
export interface UsageStatsQuery {
  period: string;
  tenantId?: string;
}

/** The pharmacies of the networks by name (open ones and closed ones with receipts in the period, D11). */
export interface UsageStatsResponse {
  period: string;
  kpi: UsageKpi;
  rows: UsageTenantRow[];
  /** The oldest refresh of the marts of the networks shown (D7). */
  asOf: string | null;
}

// ── Notifications and announcements ───────────────────────────────────────────────────────

/**
 * Topics of the operator notifications (spec 2026-10-19-operator-notifications, N5): `billing` —
 * invoice_overdue, payment_recorded; `keys` — key_expiring, key_revoked; `services` —
 * service_requested; `sync` — sync_stale, update_available.
 */
export type NotificationTopic = 'billing' | 'keys' | 'services' | 'sync';

/**
 * One operator notification (N1, N3, N4): a state (overdue invoice, expiring key, stale sync, pending
 * request) is shown while it lasts and gets new params; an event (payment, revoked key) is shown 30
 * days. `read` — read by this operator; the author of an event has it read at once.
 */
export interface PlatformNotification {
  id: string;
  topic: NotificationTopic;
  kind: EventKind;
  params: EventParams;
  target: EventTarget;
  createdAt: string;
  read: boolean;
}

/**
 * GET /operator/notifications?topic&bell&limit&offset (`platform:view`): `bell` — only the topics the
 * operator keeps on for the bell (N9); `limit` 1–50, 20 by default (N7).
 */
export interface NotificationListQuery {
  topic?: NotificationTopic;
  bell?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * POST /operator/notifications/read-all → 204: the visible notifications up to `upTo` — the newest id
 * the operator saw (ids are UUIDv7, in the order of insertion) — are read; one that appeared after the
 * list was loaded stays unread. Without `upTo` — every visible one.
 */
export interface ReadAllNotificationsRequest {
  upTo?: string;
}

/** Newest first; `counts` and `unread` — of the visible notifications (N7). */
export interface NotificationListResponse extends Page<PlatformNotification> {
  counts: Record<'all' | NotificationTopic, number>;
  unread: number;
}

export type AnnouncementScope = 'all' | 'cloud' | 'offline';
export type AnnouncementStatus = 'scheduled' | 'published' | 'cancelled';

/**
 * GET /operator/announcements (`platform:view`) — not cancelled and not ended, by the start (N11):
 * `scheduled` — the display has not begun, `published` — it is on; `cancelled` — the answer of the
 * cancellation. The title and the text are as the operator wrote them.
 */
export interface Announcement {
  id: string;
  title: string;
  text: string;
  startsAt: string;
  endsAt: string;
  scope: AnnouncementScope;
  status: AnnouncementStatus;
}

/**
 * POST /operator/announcements (`platform:manage`) → 201 `Announcement`: shown in the cloud client
 * product to the networks of the scope from `startsAt` to `endsAt` (N13, N14). 400 `validation_failed`
 * — `title` 3–120, `text` 10–1000 characters, `endsAt` (`before_start`, `past`). POST
 * /operator/announcements/{id}/cancellation → 200; 404; 409 `not_active` — cancelled or ended (N12). Both need a
 * fresh sign-in: 403 `fresh_auth_required` (security review 2026-10-22, Z10).
 */
export interface CreateAnnouncementRequest {
  title: string;
  text: string;
  startsAt: string;
  endsAt: string;
  scope: AnnouncementScope;
}

/**
 * GET/PUT /operator/me/notification-preferences (`platform:view`) — the topics the bell and the menu
 * counter show, of this operator only; all on by default; not the «Уведомления» page (N9).
 */
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
 * GET /operator/operator-audit-log — read only, newest first. `operatorId` — everything about the
 * operator: what they did and what was done to their account, such as a failed sign-in (auth3-M3,
 * 2026-10-16); `from` and `to` — calendar dates (YYYY-MM-DD) of the platform time zone, both included.
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

/**
 * The requisites of the platform printed on every invoice (spec 2026-10-15-billing-services, A20):
 * INN 9 digits, settlement and correspondent accounts 20 digits, BIK 9 digits; the payment purpose
 * template contains `{number}` (the invoice number).
 */
export interface PlatformRequisites {
  name: string;
  inn: string;
  bankAccount: string;
  bankName: string;
  bankBik: string;
  bankCorrAccount: string;
  paymentPurposeTemplate: string;
}

/**
 * GET /operator/settings (`platform:view`); PUT /operator/settings (`platform:manage`, 403
 * `fresh_auth_required` without a recent sign-in; 400). The tariff of a cloud pharmacy per month
 * (1…10 000 000 000 dirams, without VAT) and the VAT rate (a whole percent 0–99) apply to invoices
 * generated after the change; issued invoices keep their own (B14). The offline settings come with
 * the offline stores (B6).
 */
export interface PlatformSettings {
  pricePerStoreMinor: number;
  vatRatePercent: number;
  supplier: PlatformRequisites;
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
 * used. 400 for an id that is not a UUID, 404, 409 `cannot_issue_self` (a code would set one's own
 * password without the current one), 409 `operator_disabled`, 403 `fresh_auth_required`.
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

/** PATCH /operator/me — the name (printable, 1–200 characters) and the interface language. */
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
