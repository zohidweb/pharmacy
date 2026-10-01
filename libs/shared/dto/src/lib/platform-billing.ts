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
  ServiceBilling,
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

/** GET /platform/invoices?filter&limit&offset */
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

/** GET /platform/invoices/generation-preview?period */
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

/** POST /platform/invoices/generations — only for a closed period. */
export interface GenerateInvoicesRequest {
  period: BillingPeriod;
}

export interface GenerateInvoicesResponse {
  created: number;
}

/** GET /platform/invoices/{id}/recalculation-preview */
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

/** POST /platform/payments */
export interface RecordPaymentRequest {
  invoiceId: string;
  amountMinor: number;
  paidOn: string;
  method: PaymentMethod;
  /** Date-only "paid until" applied to all cloud stores of the tenant. */
  paidUntil?: string;
  comment?: string;
}

/** PATCH /platform/payments/{id} */
export interface UpdatePaymentRequest {
  amountMinor: number;
  paidOn: string;
  method: PaymentMethod;
  comment: string;
}

/** POST /platform/payments/{id}/cancellation — payments are cancelled, never deleted (audit). */
export interface CancelPaymentRequest {
  reason: string;
}

// ── Services ──────────────────────────────────────────────────────────────────────────────

export interface PlatformService {
  id: string;
  name: string;
  description: string;
  billing: ServiceBilling;
  priceMinor: number;
  visibleInCatalog: boolean;
  tenants: number;
}

export interface UpsertServiceRequest {
  name: string;
  description: string;
  billing: ServiceBilling;
  priceMinor: number;
  visibleInCatalog: boolean;
}

export interface ServiceRequestItem {
  id: string;
  serviceId: string;
  serviceName: string;
  tenantId: string;
  tenantName: string;
  requestedAt: string;
  billing: ServiceBilling;
  priceMinor: number;
}

/** POST /platform/service-requests/{id}/rejection */
export interface RejectServiceRequest {
  reason: string;
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

/** GET /platform/licenses?filter&sort&direction */
export interface LicenseListResponse {
  items: LicenseListItem[];
  counts: Record<LicenseListFilter, number>;
}

export type LicenseTermChoice = LicenseTerm | 'custom';

/** POST /platform/licenses (issue) and POST /platform/licenses/{id}/renewal */
export interface IssueLicenseRequest {
  storeId: string;
  term: LicenseTermChoice;
  /** Required for term "custom": date-only. */
  validUntil?: string;
  notifyDaysBefore: number;
  syncSchedule: SyncSchedule;
}

export type RenewLicenseRequest = Omit<IssueLicenseRequest, 'storeId'>;

/** POST /platform/licenses/{id}/revocation — takes effect at the store's next sync. */
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

/** GET /platform/installations?filter */
export interface InstallationListResponse {
  latest: Release;
  items: InstallationItem[];
  counts: Record<InstallationFilter, number>;
  updated: number;
}

/** POST /platform/installations/{storeId}/update-plans */
export interface ScheduleUpdateRequest {
  targetVersion: string;
  /** ISO instant. */
  scheduledAt: string;
  /** How the engineer connects, e.g. remote desktop agreed with the store manager. */
  accessMethod: string;
}
