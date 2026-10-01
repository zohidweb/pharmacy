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

/** List filter of GET /platform/tenants; `unpaid` = has an overdue invoice. */
export type TenantListFilter = 'all' | 'active' | 'unpaid' | 'blocked';
export type TenantSortKey =
  'name' | 'owner' | 'stores' | 'paidUntil' | 'monthlyCharge';

export interface TenantOwner {
  fullName: string;
  phone: string;
  login: string;
}

export interface TenantListItem {
  id: string;
  name: string;
  city: string;
  owner: TenantOwner;
  status: TenantStatus;
  /** At least one invoice is past due. */
  overdue: boolean;
  cloudStores: number;
  offlineStores: number;
  /** Date-only; latest "paid until" over the tenant's cloud stores, null if none. */
  paidUntil: string | null;
  /** Charge for the current month without VAT. */
  monthlyChargeMinor: number;
}

/** GET /platform/tenants?filter&q&sort&direction&limit&offset */
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

/** POST /platform/tenants/{id}/block */
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
  /** Cloud stores: date-only "paid until". */
  paidUntil: string | null;
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

export interface StoreDetails extends StoreSummary {
  tenantName: string;
  managerName: string;
  managerPhone: string;
  cashiers: number;
  /** Date-only. */
  connectedOn: string;
  installedVersion: string | null;
  latestVersion: string;
  monthReceipts: number;
  license: StoreLicense | null;
  syncHistory: SyncHistoryEntry[];
  syncQueue: Array<{ kind: SyncQueueKind; operations: number }>;
}

/** PATCH /platform/stores/{id} */
export interface UpdateStoreRequest {
  name: string;
  address: string;
  managerName: string;
  managerPhone: string;
}

/** PATCH /platform/stores/{id}/license-settings */
export interface UpdateStoreLicenseSettingsRequest {
  notifyDaysBefore: number;
  syncSchedule: SyncSchedule;
}

/** POST /platform/stores/{id}/cloud-migrations */
export interface MigrateStoreToCloudRequest {
  /** Date-only: "paid until" of the first cloud period. */
  paidUntil: string;
}

// ── Tenant tabs ───────────────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'issued' | 'paid' | 'overdue';

export interface TenantInvoiceItem {
  id: string;
  number: string;
  /** `YYYY-MM`. */
  period: string;
  stores: number;
  hasServices: boolean;
  totalMinor: number;
  status: InvoiceStatus;
}

export type PaymentMethod = 'bank_transfer' | 'cash';

export interface TenantPaymentItem {
  id: string;
  /** Date-only. */
  paidOn: string;
  amountMinor: number;
  method: PaymentMethod;
  recordedBy: string;
}

export type ServiceBilling = 'one_time' | 'monthly';

export interface TenantServiceItem {
  id: string;
  name: string;
  billing: ServiceBilling;
  /** Date-only. */
  connectedOn: string;
  status: 'active' | 'pending';
  priceMinor: number;
}

export interface TenantDailySales {
  /** Date-only. */
  date: string;
  salesMinor: number;
}

export interface TenantStats {
  receipts: number;
  salesMinor: number;
  averageReceiptMinor: number;
  activeCashiers: number;
  daily: TenantDailySales[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actorName: string;
  actorIsPlatformOperator: boolean;
  storeName: string | null;
  action: string;
}

// ── Create tenant (wizard) ────────────────────────────────────────────────────────────────

/** POST /platform/tenants — the operator creates a tenant with its owner and first store. */
export interface CreateTenantRequest {
  name: string;
  city: string;
  inn: string;
  owner: TenantOwner;
  firstStore: {
    name: string;
    address: string;
    mode: StoreMode;
    /** Offline only. */
    licenseTerm?: LicenseTerm;
    /** Offline only. */
    syncSchedule?: SyncSchedule;
  };
  /** Date-only: end of the trial period. */
  paidUntil: string;
  pricePerStoreMinor: number;
}

export type LicenseTerm = 'week' | 'quarter' | 'year';

export interface CreateTenantResponse {
  id: string;
}
