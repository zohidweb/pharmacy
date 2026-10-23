/*
 * REST contract of the platform-operator screens "Компании", "Компания", "Точка", "Новая компания"
 * (cross-tenant access through the platform role, ADR-0013). Shapes only: apps/api implements them
 * as class-validator DTO classes; frontends use `import type` (ADR-0015).
 * Money: integer dirams (*Minor), TJS only (ADR-0016). Dates: `YYYY-MM-DD` (date-only) or ISO
 * instants (`...At`). Terms: glossary (tenant, store, license key, invoice, service, audit log).
 */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ── Tenants ───────────────────────────────────────────────────────────────────────────────

/** Access state of a tenant set by the operator; billing debt is reported separately. */
export type TenantStatus = 'active' | 'blocked';

/** List filter of GET /operator/tenants; `unpaid` = has an overdue debt. */
export type TenantListFilter = 'all' | 'active' | 'unpaid' | 'blocked';
export type TenantSortKey = 'name' | 'owner' | 'stores' | 'debt';

export interface TenantOwner {
  fullName: string;
  phone: string;
  /** Optional; a sign-in identifier, unique on the whole platform with login and phone (ADR-0008). */
  email?: string;
  login: string;
}

export interface TenantListItem {
  id: string;
  name: string;
  city: string;
  owner: TenantOwner;
  status: TenantStatus;
  /** An overdue debt above 0. */
  overdue: boolean;
  cloudStores: number;
  offlineStores: number;
  /** Σ (total − paid) of the invoices (spec 2026-10-15-billing-services, 5; B12). */
  debtMinor: number;
  /** The same over the invoices past their due date. */
  overdueDebtMinor: number;
  /** Payments not allocated to invoices (B2). */
  advanceMinor: number;
  /** The discount of the current month (A10). */
  discount: { percentBp: number; toMonth: string } | null;
}

/** GET /operator/tenants?filter&q&sort&direction&limit&offset */
export interface TenantListQuery {
  filter?: TenantListFilter;
  q?: string;
  sort?: TenantSortKey;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface TenantListResponse extends Page<TenantListItem> {
  counts: Record<TenantListFilter, number>;
}

export interface TenantBlockInfo {
  blockedAt: string;
  blockedBy: string;
  reason: string;
}

export interface TenantDetails extends TenantListItem {
  inn: string;
  /** Date-only: the tenant joined the platform. */
  joinedOn: string;
  block: TenantBlockInfo | null;
}

/** POST /operator/tenants/{id}/block */
export interface BlockTenantRequest {
  reason: string;
}

// ── Stores ────────────────────────────────────────────────────────────────────────────────

export type StoreMode = 'cloud' | 'offline';
export type StoreStatus = 'active' | 'closed';

export type SyncSchedule = 'daily' | 'twice_daily' | 'hourly' | 'manual';

export interface StoreSummary {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  mode: StoreMode;
  status: StoreStatus;
  /** Date-only, when status is closed. */
  closedOn: string | null;
  /** Offline stores: date-only license key expiry. */
  licenseValidUntil: string | null;
  /** Offline stores: last successful sync instant. */
  lastSyncAt: string | null;
  monthSalesMinor: number;
}

export interface StoreLicense {
  code: string;
  validUntil: string;
  /** Overrides the platform default (PlatformSettings.keyExpiryNoticeDays). */
  notifyDaysBefore: number;
  syncSchedule: SyncSchedule;
}

export type SyncResult = 'ok' | 'ok_with_conflicts' | 'no_connection';

export interface SyncHistoryEntry {
  at: string;
  operations: number;
  version: string;
  result: SyncResult;
  conflicts: number;
}

export type SyncQueueKind =
  'sales' | 'returns' | 'stock_movements' | 'price_changes';

/**
 * GET /operator/stores/{id} (`tenants:view`; spec 2026-10-23-admin-store-card-tenant-log): what the platform may see —
 * the store registry, the statistics marts and the platform tables (ADR-0013 §5). No employees of the store; the
 * owner of the network edits the store, the operator does not. 404 `not_found`.
 */
export interface StoreDetails extends StoreSummary {
  tenantName: string;
  /** Date-only: when the store was created. */
  connectedOn: string;
  /** Receipts of the current month (Asia/Dushanbe) from the marts; `monthSalesMinor` — their sum. */
  monthReceipts: number;
  /** The time of the last refresh of the marts of the network; null — never refreshed. */
  asOf: string | null;
  /** The offline part of the admin is not in the pilot: null and empty until it is (A5). */
  installedVersion: string | null;
  latestVersion: string | null;
  license: StoreLicense | null;
  syncHistory: SyncHistoryEntry[];
  syncQueue: Array<{ kind: SyncQueueKind; operations: number }>;
}

/** PATCH /operator/stores/{id}/license-settings */
export interface UpdateStoreLicenseSettingsRequest {
  notifyDaysBefore: number;
  syncSchedule: SyncSchedule;
}

/** POST /operator/stores/{id}/cloud-migrations */
export interface MigrateStoreToCloudRequest {
  /** Date-only: "paid until" of the first cloud period. */
  paidUntil: string;
}

// ── Tenant tabs ───────────────────────────────────────────────────────────────────────────

/** Derived from the allocation (spec 2026-10-15-billing-services, A8); overdue is a flag. */
export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid';

export interface TenantInvoiceItem {
  id: string;
  number: string;
  /** `YYYY-MM`. */
  period: string;
  stores: number;
  hasServices: boolean;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  status: InvoiceStatus;
  overdue: boolean;
  /** Date-only. */
  dueOn: string;
}

export type PaymentMethod = 'bank_transfer' | 'cash';

export interface TenantPaymentItem {
  id: string;
  /** Date-only. */
  paidOn: string;
  amountMinor: number;
  method: PaymentMethod;
  recordedBy: string;
  /** The invoice the payment goes to first, if chosen. */
  invoiceNumber: string | null;
  comment: string | null;
  cancelled: boolean;
}

// The «Услуги» tab of a company: `TenantServiceItem[]` of platform-billing.ts.

export interface TenantDailySales {
  /** Date-only. */
  date: string;
  salesMinor: number;
}

/**
 * GET /operator/tenants/{id}/stats (`tenants:view`): the current month and the 14 days to today of one
 * network (spec 2026-10-19-admin-dashboard-stats, 6); an unknown network — 404.
 */
export interface TenantStats {
  receipts: number;
  /** The sum of the receipts, returns not subtracted. */
  salesMinor: number;
  averageReceiptMinor: number;
  /** Different cashiers with a receipt in the month. */
  activeCashiers: number;
  daily: TenantDailySales[];
  /** The time of the last refresh of the marts of the network; null — never refreshed. */
  asOf: string | null;
}

// ── Create tenant (wizard) ────────────────────────────────────────────────────────────────

/**
 * POST /operator/tenants — the operator creates a network and its owner (spec
 * 2026-10-05-tenants-module); the owner adds stores after activation. Needs `tenants:manage` and a
 * fresh operator sign-in. Errors: 409 `inn_taken`, `login_taken`, `phone_taken`, `email_taken`;
 * 400 `validation_failed`.
 */
export interface CreateTenantRequest {
  name: string;
  city: string;
  /** 9 digits. */
  inn: string;
  owner: TenantOwner;
}

export type LicenseTerm = 'week' | 'quarter' | 'year';

/**
 * 201 from POST /operator/tenants. `activationCode` is the owner's one-time activation code: shown
 * to the operator once (it is stored as a hash only) and handed to the owner, who passes it to
 * POST /api/v1/activations to set the first password.
 */
export interface CreateTenantResponse {
  id: string;
  activationCode: string;
  /** ISO 8601; the code's lifetime is ACTIVATION_CODE_TTL_HOURS of the API. */
  activationCodeExpiresAt: string;
}

/**
 * 201 from POST /operator/tenants/{id}/owner-activation-codes — a new one-time code for the
 * owner (the password stays until the code is used); shown once. 409 `tenant_blocked`.
 */
export interface IssueOwnerCodeResponse {
  activationCode: string;
  /** ISO 8601; the code's lifetime is ACTIVATION_CODE_TTL_HOURS of the API. */
  activationCodeExpiresAt: string;
}
