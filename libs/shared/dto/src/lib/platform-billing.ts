/*
 * REST contract of the operator screens «Счета и платежи», «Услуги», «Лицензионные ключи»,
 * «Версии установок». Shapes only (apps/api implements class-validator DTOs; frontends use
 * `import type`, ADR-0015). Money: integer dirams, TJS only (ADR-0016); VAT is a separate line.
 * Payments carry their client `id` as the idempotency key; a repeated generation creates nothing.
 */
import type {
  InvoiceStatus,
  LicenseTerm,
  Page,
  PaymentMethod,
  SyncSchedule,
} from './platform-tenants.js';
import type { PlatformRequisites } from './platform-system.js';

// ── Invoices and payments (spec 2026-10-15-billing-services, B1–B5, B10, A1–A11) ─────────────

/** `YYYY-MM` billing period. */
export type BillingPeriod = string;

/** GET /operator/billing/summary?period — the period's invoices; the overdue debt over all periods. */
export interface BillingSummary {
  period: BillingPeriod;
  issuedMinor: number;
  /** Paid on the invoices of the period. */
  paidMinor: number;
  invoices: number;
  paidInvoices: number;
  overdueMinor: number;
  overdueTenants: number;
  /** From the invoices of the period, otherwise the current settings. */
  pricePerStoreMinor: number;
  vatRatePercent: number;
}

export interface InvoiceListItem {
  id: string;
  /** `СЧ-ГГГГ-ММ-NNN` (A4). */
  number: string;
  tenantId: string;
  tenantName: string;
  period: BillingPeriod;
  /** Store lines of the invoice. */
  stores: number;
  hasServices: boolean;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  /** What the allocation of payments put on the invoice (A7). */
  paidMinor: number;
  remainingMinor: number;
  /** Derived (A8): `paid` at paid = total, `partially_paid` above 0, otherwise `issued`. */
  status: InvoiceStatus;
  /** A remainder after the due date (A8): a flag, not a status. */
  overdue: boolean;
  issuedAt: string;
  /** Date-only. */
  dueOn: string;
  /** Date-only: the day the invoice became fully paid. */
  paidOn: string | null;
}

/** `unpaid` — a remainder above 0; `overdue` — a remainder after the due date. */
export type InvoiceListFilter = 'all' | 'unpaid' | 'overdue' | 'paid';

/** GET /operator/invoices?filter&tenantId&period&limit&offset */
export interface InvoiceListQuery {
  filter?: InvoiceListFilter;
  tenantId?: string;
  period?: BillingPeriod;
  limit?: number;
  offset?: number;
}

/** Counts per filter over the same tenant and period. */
export interface InvoiceListResponse extends Page<InvoiceListItem> {
  counts: Record<InvoiceListFilter, number>;
}

/**
 * A line of an invoice. A store: its name, billed days of the month (A2) and the discount of the
 * network (A10); a service: its Russian name and the day it was provided (A11).
 */
export interface InvoiceLine {
  id: string;
  kind: 'store' | 'service';
  description: string;
  storeId: string | null;
  days: number | null;
  daysInMonth: number | null;
  /** The charge of the store before the discount. */
  baseMinor: number | null;
  discountBp: number | null;
  discountMinor: number | null;
  tenantServiceId: string | null;
  /** Date-only. */
  providedOn: string | null;
  amountMinor: number;
}

/** GET /operator/invoices/{id} — with the snapshot taken when it was issued (A5), for the card and print. */
export interface InvoiceDetails extends InvoiceListItem {
  pricePerStoreMinor: number;
  vatRatePercent: number;
  /** The requisites of the platform at issue; the purpose is resolved in `paymentPurpose`. */
  supplier: Omit<PlatformRequisites, 'paymentPurposeTemplate'>;
  payer: { name: string; inn: string };
  paymentPurpose: string;
  recalculatedAt: string | null;
  lines: InvoiceLine[];
}

export type PeriodState = 'closed' | 'current' | 'future';

/** GET /operator/invoices/generation-preview?period */
export interface InvoiceGenerationPreview {
  period: BillingPeriod;
  state: PeriodState;
  /** Date-only: the day invoices of the period can be generated from (A1). */
  opensOn: string;
  rows: Array<{
    tenantId: string;
    tenantName: string;
    stores: number;
    services: number;
    totalMinor: number;
    /** The invoice exists already; `totalMinor` is its total. */
    invoiced: boolean;
  }>;
  /** Total of the invoices not issued yet. */
  totalMinor: number;
}

/** POST /operator/invoices/generations — only for a closed period; a repeat creates nothing. */
export interface GenerateInvoicesRequest {
  period: BillingPeriod;
}

export interface GenerateInvoicesResponse {
  created: number;
}

/** GET /operator/invoices/{id}/recalculation-preview — only an invoice without payments (A6). */
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
  /** The invoice the payment goes to first (B2); the rest covers the oldest ones. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountMinor: number;
  method: PaymentMethod;
  recordedBy: string;
  comment: string | null;
  cancelled: boolean;
  cancelReason: string | null;
}

/** GET /operator/payments?tenantId&limit&offset — newest first. */
export interface PaymentListQuery {
  tenantId?: string;
  limit?: number;
  offset?: number;
}

/**
 * POST /operator/payments — a payment of a network (B2). `id` (UUIDv7) is made by the client and is
 * the idempotency key (A9): the same body gets the same answer, another one 409.
 */
export interface RecordPaymentRequest {
  id: string;
  tenantId: string;
  invoiceId?: string | null;
  amountMinor: number;
  /** Date-only, not in the future. */
  paidOn: string;
  method: PaymentMethod;
  comment?: string | null;
}

/** PATCH /operator/payments/{id} — the allocation is computed again (A7). */
export interface UpdatePaymentRequest {
  amountMinor: number;
  paidOn: string;
  method: PaymentMethod;
  comment: string | null;
}

/** POST /operator/payments/{id}/cancellation — payments are cancelled, never deleted (audit). */
export interface CancelPaymentRequest {
  reason: string;
}

/**
 * A discount of a network on the store tariff for months `fromMonth`…`toMonth` (A10). Periods of one
 * network do not overlap. `invoicedThrough` — the last month whose invoice took the discount: before
 * it the period cannot end, and with it the discount cannot be removed.
 */
export interface TenantDiscount {
  id: string;
  /** 100…10 000 (1–100 %). */
  percentBp: number;
  /** `YYYY-MM`. */
  fromMonth: string;
  toMonth: string;
  invoicedThrough: string | null;
}

/** POST /operator/tenants/{id}/discounts — needs a recent sign-in. */
export interface AddTenantDiscountRequest {
  percentBp: number;
  fromMonth: string;
  toMonth: string;
}

/** PATCH /operator/discounts/{id} — shortens the period; a longer one is a new discount. */
export interface ShortenTenantDiscountRequest {
  toMonth: string;
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
 * network, unknown or archived service). `id` (UUIDv7) is made by the client and is the idempotency
 * key (B17): the same body gets the same answer, another one 409 `idempotency_conflict`.
 */
export interface AddTenantServiceRequest {
  id: string;
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
