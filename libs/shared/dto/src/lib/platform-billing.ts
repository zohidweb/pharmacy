/*
 * REST contract of the operator screens «Счета и платежи», «Услуги», «Лицензионные ключи»,
 * «Версии установок». Shapes only (apps/api implements class-validator DTOs; frontends use
 * `import type`, ADR-0015). Money: integer dirams, TJS only (ADR-0016); VAT is a separate line.
 * Financial writes (payments, invoice generation) carry an Idempotency-Key header.
 */
import type {
  InvoiceStatus,
  LicenseTerm,
  Page,
  PaymentMethod,
  SyncSchedule,
} from './platform-tenants.js';

// ── Invoices and payments ─────────────────────────────────────────────────────────────────

/** `YYYY-MM` billing period. */
export type BillingPeriod = string;

export interface BillingSummary {
  period: BillingPeriod;
  issuedMinor: number;
  paidMinor: number;
  invoices: number;
  paidInvoices: number;
  overdueMinor: number;
  overdueTenants: number;
  pricePerStoreMinor: number;
  vatRatePercent: number;
}

export interface InvoiceListItem {
  id: string;
  number: string;
  tenantId: string;
  tenantName: string;
  period: BillingPeriod;
  stores: number;
  hasServices: boolean;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  status: InvoiceStatus;
  /** Date-only. */
  dueOn: string;
}

export type InvoiceListFilter = 'all' | 'paid' | 'overdue';

/** GET /operator/invoices?filter&limit&offset */
export interface InvoiceListResponse extends Page<InvoiceListItem> {
  counts: Record<InvoiceListFilter, number>;
}

export interface InvoiceLine {
  kind: 'store' | 'service';
  description: string;
  /** Billed days of the period (proration); null for one-time services. */
  days: number | null;
  amountMinor: number;
}

export interface InvoiceDetails extends InvoiceListItem {
  vatRatePercent: number;
  lines: InvoiceLine[];
}

export type PeriodState = 'closed' | 'current' | 'future';

/** GET /operator/invoices/generation-preview?period */
export interface InvoiceGenerationPreview {
  period: BillingPeriod;
  state: PeriodState;
  rows: Array<{
    tenantId: string;
    tenantName: string;
    activeStores: number;
    totalMinor: number;
  }>;
  totalMinor: number;
}

/** POST /operator/invoices/generations — only for a closed period. */
export interface GenerateInvoicesRequest {
  period: BillingPeriod;
}

export interface GenerateInvoicesResponse {
  created: number;
}

/** GET /operator/invoices/{id}/recalculation-preview */
export interface RecalculationPreview {
  beforeMinor: number;
  afterMinor: number;
}

export interface PaymentListItem {
  id: string;
  /** Date-only. */
  paidOn: string;
  tenantId: string;
  tenantName: string;
  invoiceId: string;
  invoiceNumber: string;
  amountMinor: number;
  method: PaymentMethod;
  recordedBy: string;
  comment: string;
  cancelled: boolean;
}

/** POST /operator/payments */
export interface RecordPaymentRequest {
  invoiceId: string;
  amountMinor: number;
  paidOn: string;
  method: PaymentMethod;
  /** Date-only "paid until" applied to all cloud stores of the tenant. */
  paidUntil?: string;
  comment?: string;
}

/** PATCH /operator/payments/{id} */
export interface UpdatePaymentRequest {
  amountMinor: number;
  paidOn: string;
  method: PaymentMethod;
  comment: string;
}

/** POST /operator/payments/{id}/cancellation — payments are cancelled, never deleted (audit). */
export interface CancelPaymentRequest {
  reason: string;
}

// ── Services (spec 2026-10-15-billing-services, B7–B9, A11–A14) ─────────────────────────────

/**
 * A one-time service of the platform catalog (data migration, an engineer's visit, training). The
 * base price is a guide: the operator sets the price of each order when approving it. A hidden
 * service is not offered to owners but can be added to a network; an archived one is neither.
 */
export interface PlatformService {
  id: string;
  nameRu: string;
  /** Null: owners with the Tajik interface see the Russian name. */
  nameTj: string | null;
  descriptionRu: string;
  descriptionTj: string | null;
  basePriceMinor: number;
  visible: boolean;
  archived: boolean;
  /** Networks with the service approved or provided. */
  tenants: number;
}

/**
 * POST /operator/services, PUT /operator/services/{id} (`platform:manage`). Names 1–120 characters
 * (Tajik optional), descriptions up to 1000, price 1…10 000 000 000 dirams. 400, 404.
 */
export type UpsertServiceRequest = Omit<PlatformService, 'id' | 'tenants'>;

/** GET /operator/service-requests — the requests of networks without a decision, oldest first. */
export interface ServiceRequestItem {
  id: string;
  serviceId: string;
  serviceName: string;
  tenantId: string;
  tenantName: string;
  requestedAt: string;
  basePriceMinor: number;
  comment: string | null;
}

/**
 * POST /operator/service-requests/{id}/approval → 201 `TenantServiceItem`. 404 (unknown or withdrawn
 * request), 409 `service_decided`.
 */
export interface ApproveServiceRequest {
  priceMinor: number;
}

/**
 * POST /operator/service-requests/{id}/rejection → 201 `TenantServiceItem`; the owner sees the
 * reason (5–500 characters). 404, 409 `service_decided`.
 */
export interface RejectServiceRequest {
  reason: string;
}

export type TenantServiceStatus =
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'provided';

/**
 * A decision of the operator on a request, or a service the operator added without one. The
 * price is null for a rejected request; `providedOn` (date-only) is set for a provided one.
 */
export interface TenantServiceItem {
  id: string;
  serviceId: string;
  serviceName: string;
  tenantId: string;
  tenantName: string;
  status: TenantServiceStatus;
  priceMinor: number | null;
  /** Of a rejection or a cancellation. */
  reason: string | null;
  requestId: string | null;
  requestedAt: string | null;
  comment: string | null;
  decidedAt: string;
  decidedBy: string;
  providedOn: string | null;
}

/**
 * POST /operator/tenants/{id}/services → 201 `TenantServiceItem` (approved at once). 404 (unknown
 * network, unknown or archived service).
 */
export interface AddTenantServiceRequest {
  serviceId: string;
  priceMinor: number;
}

/**
 * POST /operator/tenant-services/{id}/provision — date-only, not in the future and not before the
 * day of the decision (`Asia/Dushanbe`). 409 `service_not_approved`. DELETE of the same path
 * takes the mark back (409 `service_not_approved` unless provided).
 */
export interface ProvideTenantServiceRequest {
  providedOn: string;
}

/** PATCH /operator/tenant-services/{id} — the price of an approved or provided service. 409 `service_not_approved`. */
export interface UpdateTenantServiceRequest {
  priceMinor: number;
}

/** POST /operator/tenant-services/{id}/cancellation — 409 `service_not_approved` (rejected or cancelled). */
export interface CancelTenantServiceRequest {
  reason: string;
}

/** GET /operator/tenant-services?status&tenantId — newest first. */
export interface TenantServiceQuery {
  status?: TenantServiceStatus;
  tenantId?: string;
}

// ── License keys ──────────────────────────────────────────────────────────────────────────

/** Stored state; "expired" is derived from validUntil by the client. */
export type LicenseKeyState = 'active' | 'revoked';
export type LicenseListFilter = 'all' | 'expiring' | 'inactive';
export type LicenseSortKey = 'store' | 'tenant' | 'validUntil';

export interface LicenseListItem {
  id: string;
  storeId: string;
  storeName: string;
  city: string;
  tenantId: string;
  tenantName: string;
  code: string;
  validUntil: string;
  notifyDaysBefore: number;
  syncSchedule: SyncSchedule;
  lastSyncAt: string | null;
  state: LicenseKeyState;
  revokeReason: string | null;
}

/** GET /operator/licenses?filter&sort&direction */
export interface LicenseListResponse {
  items: LicenseListItem[];
  counts: Record<LicenseListFilter, number>;
}

export type LicenseTermChoice = LicenseTerm | 'custom';

/** POST /operator/licenses (issue) and POST /operator/licenses/{id}/renewal */
export interface IssueLicenseRequest {
  storeId: string;
  term: LicenseTermChoice;
  /** Required for term "custom": date-only. */
  validUntil?: string;
  notifyDaysBefore: number;
  syncSchedule: SyncSchedule;
}

export type RenewLicenseRequest = Omit<IssueLicenseRequest, 'storeId'>;

/** POST /operator/licenses/{id}/revocation — takes effect at the store's next sync. */
export interface RevokeLicenseRequest {
  reason: string;
}

export interface OfflineStoreOption {
  id: string;
  name: string;
  tenantName: string;
  hasActiveLicense: boolean;
}

// ── Installations and releases ────────────────────────────────────────────────────────────

export type InstallationState = 'current' | 'behind' | 'unsupported';
export type InstallationFilter = 'all' | 'outdated' | 'critical';

export interface Release {
  version: string;
  /** Date-only. */
  releasedOn: string;
  notes: string;
  /** Date-only end of support, null while supported. */
  supportedUntil: string | null;
}

export interface InstallationItem {
  storeId: string;
  storeName: string;
  city: string;
  tenantName: string;
  version: string;
  /** Date-only. */
  updatedOn: string;
  os: string;
  ramGb: number;
  state: InstallationState;
  /** Releases behind the latest. */
  behindBy: number;
  /** Date-only, for unsupported versions. */
  supportedUntil: string | null;
  plannedUpdateAt: string | null;
}

/** GET /operator/installations?filter */
export interface InstallationListResponse {
  latest: Release;
  items: InstallationItem[];
  counts: Record<InstallationFilter, number>;
  updated: number;
}

/** POST /operator/installations/{storeId}/update-plans */
export interface ScheduleUpdateRequest {
  targetVersion: string;
  /** ISO instant. */
  scheduledAt: string;
  /** How the engineer connects, e.g. remote desktop agreed with the store manager. */
  accessMethod: string;
}
