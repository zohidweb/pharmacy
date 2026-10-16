/*
 * REST contract of the owner cabinet (ТЗ «Кабинет владельца», UI mockups «Точки, услуги, оплата»,
 * «Отчёты», «Настройки», «Офлайн-точка»). Amounts are integer dirams, TJS only (ADR-0016) — no
 * exchange rates. The owner creates stores and their legal entities (spec 2026-10-06-owner-stores);
 * closing a store moves its stock by a transfer and completes when the receiver accepts it. Offline stores (ADR-0014):
 * the cloud shows their synchronisation; an offline store decides its product duplicates itself.
 */
import type { InvoiceLine } from './platform-billing.js';
import type { InvoiceStatus, Page, StoreMode } from './platform-tenants.js';
import type { ExpenseKind } from '@pharmacy/shared-domain';
import type { NotificationKind } from './tenant-home.js';

/* ---------------- stores ---------------- */

export type OwnerStoreStatus = 'pending' | 'active' | 'closing' | 'closed';

/** A pharmacy sells; a warehouse only stores (terminals and shifts are refused by the API). */
export type StoreKind = 'pharmacy' | 'warehouse';

/**
 * A legal entity of the network (data model 01, `legal_entities`): the requisites of the receipt and
 * of the 1C export of its stores. The owner creates it in the store form (spec
 * 2026-10-06-owner-stores, S2).
 */
export interface LegalEntity {
  id: string;
  name: string;
  /** 9 digits; unique among the active legal entities of the network. */
  taxId: string;
  legalAddress: string;
  phone: string | null;
  email: string | null;
  bankDetails: string | null;
  /** Stores of the network that belong to this legal entity (any status). */
  stores: number;
}

/** POST /api/v1/legal-entities (`stores:create`). 409 `tax_id_taken`, 400 `validation_failed`. */
export type LegalEntityInput = Pick<
  LegalEntity,
  'name' | 'taxId' | 'legalAddress' | 'phone' | 'email' | 'bankDetails'
>;

/** PATCH /api/v1/legal-entities/{id} (`stores:update`). 404, 409 `tax_id_taken`. */
export type UpdateLegalEntityRequest = Partial<LegalEntityInput>;

/** GET /api/v1/legal-entities (`stores:view`). */
export interface LegalEntitiesResponse {
  /** Active legal entities of the network, by name. */
  items: LegalEntity[];
  /** The network's own name and INN, to prefill the first legal entity. */
  defaults: { name: string; taxId: string | null };
}

export interface OwnerStore {
  id: string;
  name: string;
  /** `^[A-Z0-9]{1,8}$`, unique in the network; part of document numbers, fixed after creation. */
  code: string;
  /** Actual address for the receipt. */
  address: string;
  /** Fixed after creation. */
  kind: StoreKind;
  legalEntityId: string;
  legalEntityName: string;
  /** Print the receipt right after the payment. */
  printReceiptDefault: boolean;
  mode: StoreMode;
  /**
   * `pending` — an offline kit is issued (mode offline_pending); `closing` — the stock is on its way
   * to the receiver, the store sells and posts nothing; `closed` — the receiver accepted it.
   */
  status: OwnerStoreStatus;
  /** Offline store: the license key is valid until; null until offline stores exist. */
  licenseValidUntil: string | null;
  /** 0 until the POS module exists. */
  receiptsThisMonth: number;
  /** YYYY-MM-DD of a closed store: the business date it became closed. */
  closedOn: string | null;
  /** A closing or closed store: the name of the store its stock went to (null for an empty store). */
  stockMovedTo: string | null;
  /** The transfers of the closing (spec 2026-10-15-store-closing, E6); empty for a working store. */
  closingTransfers: StoreClosingTransfer[];
  /** A closing store none of whose transfers is accepted yet: the closing can be cancelled (E10). */
  closingCancellable: boolean;
}

export interface StoreClosingTransfer {
  number: string;
  status: 'in_transit' | 'accepted';
}

/**
 * POST /api/v1/stores (`stores:create`) — a cloud store; exactly one of `legalEntityId` (an active
 * legal entity of the network) and `newLegalEntity` (created in the same transaction). Optional
 * header `Idempotency-Key` (UUID): a repeated key returns the store created with it. 201
 * `OwnerStore`; 404 (no such active legal entity), 409 `store_code_taken` / `tax_id_taken`, 400
 * `validation_failed`.
 */
export interface CreateStoreRequest {
  legalEntityId?: string;
  newLegalEntity?: LegalEntityInput;
  name: string;
  code: string;
  address: string;
  kind: StoreKind;
  printReceiptDefault: boolean;
}

/**
 * PUT /api/v1/stores/{id} (`stores:update`) — a store of the employee's scope. 404 (outside the
 * scope or no such active legal entity), 409 `store_closed`.
 */
export interface UpdateOwnerStoreRequest {
  name: string;
  address: string;
  legalEntityId: string;
  printReceiptDefault: boolean;
}

/** GET /api/v1/stores (`stores:view`) — the stores of the employee's scope, active first. */
export interface StoresOverview {
  stores: OwnerStore[];
}

export interface StoreClosingLine {
  productName: string;
  batchNumber: string;
  expiresOn: string;
  quantityPieces: number;
  piecesPerPack: number;
  /** Only with `finance:view-cost`. */
  costMinor?: number;
}

/** What forbids the closing (spec 2026-10-15-store-closing, E7). */
export type StoreClosingBlockerCode =
  | 'open_shift'
  | 'stock_count'
  | 'incoming_transfer'
  | 'outgoing_transfer'
  | 'transfer_request'
  | 'negative_stock'
  | 'period_closed';

export interface StoreClosingBlocker {
  code: StoreClosingBlockerCode;
  count: number;
}

/** What stays behind the closing and is only shown (E8). */
export type StoreClosingWarningCode =
  | 'draft_documents'
  | 'open_purchase_orders'
  | 'unpaid_receipts';

export interface StoreClosingWarning {
  code: StoreClosingWarningCode;
  count: number;
  /** The unpaid amount of `unpaid_receipts`; only with `finance:view-cost`. */
  amountMinor?: number;
}

/**
 * GET /api/v1/stores/{id}/closing-preview (`stores:delete`) — the stock that moves to the receiver,
 * the transfers it takes (500 lines each), what forbids the closing and what stays behind. 403
 * `store_not_in_scope`; 409 `offline_store_read_only` / `store_closing` / `store_closed` /
 * `last_store`.
 */
export interface StoreClosingPreview {
  lines: StoreClosingLine[];
  positions: number;
  totalCostMinor?: number;
  transfers: number;
  blockers: StoreClosingBlocker[];
  warnings: StoreClosingWarning[];
}

/**
 * POST /api/v1/stores/{id}/closing (`stores:delete`, a fresh sign-in) — sends the whole stock to the
 * receiver; the store closes when the last transfer is accepted, an empty store at once. 403
 * `fresh_auth_required` / `store_not_in_scope`; 409 as the preview and `store_not_closable` (errors[]:
 * field = the blocker code, code `blocked`), `stock_insufficient`; 422 `receiverStoreId`.
 */
export interface CloseStoreRequest {
  /** Another active cloud store; `null` only for a store without stock. */
  receiverStoreId: string | null;
}

export interface CloseStoreResponse {
  /** Empty for a store without stock (closed at once). */
  transferNumbers: string[];
  store: OwnerStore;
}

/*
 * POST /api/v1/stores/{id}/closing/cancellation (`stores:delete`, a fresh sign-in) — the transfers in
 * transit are recalled and cancelled, the store works again; 200 `OwnerStore`. 409
 * `closing_partly_received` once a transfer is accepted, `store_closed`.
 */

/* ---------------- services and billing ---------------- */

/** A service of the operator's catalog, in the language of the employee (Russian without a Tajik text). */
export interface ServiceCatalogItem {
  id: string;
  name: string;
  description: string;
  /** A guide: the operator sets the price of the order when approving it. */
  basePriceMinor: number;
}

export type ServiceOrderStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'provided';

/**
 * A request of the network and the operator's decision on it, or a service the operator added
 * without a request (`requestId` null). Only a pending request can be withdrawn.
 */
export interface ServiceOrder {
  requestId: string | null;
  serviceId: string;
  serviceName: string;
  status: ServiceOrderStatus;
  comment: string | null;
  requestedAt: string | null;
  priceMinor: number | null;
  /** Of a rejection or a cancellation. */
  reason: string | null;
  /** Date-only. */
  providedOn: string | null;
  decidedAt: string | null;
}

/** GET /api/v1/services (`services:view`) — the visible catalog and the orders of the network, newest first. */
export interface TenantServices {
  catalog: ServiceCatalogItem[];
  orders: ServiceOrder[];
}

/**
 * POST /api/v1/service-requests (`services:create`) → 201 `ServiceOrder`; comment up to 500
 * characters. 404 (unknown, hidden or archived service), 409 `service_requested` (a request for
 * this service waits for a decision). DELETE /api/v1/service-requests/{id} withdraws a pending
 * request: 204, 404, 409 `service_decided`.
 */
export interface CreateServiceRequestBody {
  serviceId: string;
  comment: string | null;
}

/** An invoice of the network (spec 2026-10-15-billing-services, 6.2; status and overdue — A8). */
export interface TenantInvoice {
  id: string;
  number: string;
  /** YYYY-MM */
  period: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  status: InvoiceStatus;
  /** A remainder after the due date. */
  overdue: boolean;
  /** Date-only. */
  dueOn: string;
  /** Date-only: the day the invoice became fully paid. */
  paidOn: string | null;
}

/**
 * The estimate of the month `period` by `through` (A19): the formulas of an invoice (A2, A3, A10)
 * over the sales from the 1st to today, at the current tariff, rate and discount; services provided
 * and not invoiced yet. The final sum is the invoice's.
 */
export interface TenantBillingEstimate {
  /** YYYY-MM */
  period: string;
  /** Date-only, inclusive. */
  through: string;
  pricePerStoreMinor: number;
  vatRatePercent: number;
  discountBp: number | null;
  lines: Array<Omit<InvoiceLine, 'id'>>;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
}

/**
 * GET /api/v1/billing (`billing:view`, 6.2): the estimate of the current month, the debt, the overdue
 * debt and the advance of the network, its discounts of the current month and later, its invoices,
 * newest first. GET /api/v1/billing/invoices/{id} gives `InvoiceDetails` (platform-billing.ts) for
 * print; 404 for an invoice of another network.
 */
export interface TenantBilling {
  estimate: TenantBillingEstimate;
  debtMinor: number;
  overdueDebtMinor: number;
  advanceMinor: number;
  discounts: Array<{ percentBp: number; fromMonth: string; toMonth: string }>;
  invoices: TenantInvoice[];
}

/* ---------------- reports ---------------- */

export type ReportKind =
  | 'sales_by_store'
  | 'sales_by_category'
  | 'stock'
  | 'movement'
  | 'supplier_debts'
  | 'cashiers'
  | 'losses'
  | 'controlled'
  /** ПКУ by product × store: opening, received, issued, closing (spec 2026-10-14-owner-cabinet, O6). */
  | 'controlled_summary';

/**
 * `quantity` — whole packs; `percent` — a number with one decimal; `reason` — a code of
 * WriteOffReason or ReturnReason, localized on the client.
 */
export type ReportColumnType =
  | 'text'
  | 'count'
  | 'money'
  | 'percent'
  | 'quantity'
  | 'date'
  | 'datetime'
  | 'reason'
  /** Pieces; the row carries `piecesPerPack` to show «N уп. M шт.» (spec 2026-10-14, E19). */
  | 'pieces';

export interface ReportColumn {
  key: string;
  type: ReportColumnType;
}

export type ReportCell = string | number | null;

export interface ReportQuery {
  kind: ReportKind;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  storeId?: string;
}

/**
 * GET /api/v1/reports/{kind}?from=&to=&storeId= — one table per report. Cost and margin columns
 * are absent without `finance:view-cost` (ADR-0018, п. 6); the expense columns of «Продажи по
 * точкам» (`expenses`, `cashExpenses`, `netProfit`) need `finance:view-cost` and `expenses:view`.
 * A row may carry keys that are not columns: `piecesPerPack` for the `pieces` columns,
 * `prescriptionPurged: 1` for a ПКУ sale whose prescription data were purged by the retention term.
 */
export interface ReportTable {
  kind: ReportKind;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  total: Record<string, ReportCell> | null;
}

/* ---------------- other expenses (spec 2026-10-14-owner-cabinet, E16, 5.6) ---------------- */

/** An expense of a month: of a store, or of the whole network (`storeId` null). */
export interface Expense {
  id: string;
  /** YYYY-MM. */
  month: string;
  storeId: string | null;
  storeName: string | null;
  kind: ExpenseKind;
  amountMinor: number;
  comment: string | null;
}

/** The cash withdrawals «на расходы» of a store in the month (read only, O9). */
export interface CashExpensesOfStore {
  storeId: string;
  storeName: string;
  amountMinor: number;
  operations: number;
}

/** GET /api/v1/expenses?month=YYYY-MM&storeId= */
export interface ExpenseListResponse {
  items: Expense[];
  totalMinor: number;
  cashExpenses: CashExpensesOfStore[];
}

export interface ExpenseQuery {
  /** YYYY-MM. */
  month: string;
  storeId?: string;
}

/** POST /api/v1/expenses; the month is not later than the current month of the network. */
export interface CreateExpenseRequest {
  /** YYYY-MM. */
  month: string;
  /** `null` — the whole network (an employee of the whole network only). */
  storeId: string | null;
  kind: ExpenseKind;
  /** 1 … 10 000 000 000 dirams. */
  amountMinor: number;
  /** ≤ 500 characters. */
  comment: string | null;
}

/** PUT /api/v1/expenses/{id} — the whole record. */
export type UpdateExpenseRequest = CreateExpenseRequest;

/* ---------------- export to 1C (CommerceML, CLAUDE.md «Integrations») ---------------- */

export type Export1cDataSet = 'sales_and_movement' | 'sales';

export interface Export1cUnmapped {
  productId: string;
  productName: string;
  barcode: string | null;
  /** Article typed earlier, taken by another product («артикул занят»). */
  conflictArticle: string | null;
}

/** GET /api/v1/exports/1c/preview?from=&to=&storeId= */
export interface Export1cPreview {
  receipts: number;
  documents: number;
  unmapped: Export1cUnmapped[];
}

/** PUT /api/v1/catalog/products/{id}/article-1c */
export interface SetArticle1cRequest {
  article: string;
}

/** POST /api/v1/exports/1c — a manual export for a period; unmapped products are left out. */
export interface Export1cRequest {
  from: string;
  to: string;
  storeId: string | null;
  dataSet: Export1cDataSet;
}

export interface Export1cResult {
  fileName: string;
  /** Link to the file of the export (application/xml). */
  downloadUrl: string;
  receipts: number;
  documents: number;
  excluded: number;
}

/* ---------------- settings ---------------- */

/** GET/PUT /api/v1/settings — network settings; every change goes to the audit log. */
export interface NetworkSettings {
  /** Read only: the operator of the platform changes it (spec 2026-10-14-owner-cabinet, E14). */
  networkName: string;
  /**
   * Idle timeout of the sessions of the employees, minutes, 5–240 (CLAUDE.md «Security
   * constraints»); applies to new sessions.
   */
  posSessionTimeoutMinutes: number;
  /** ≥ 4 (ADR-0008). */
  minPinLength: number;
  expiryNoticeDays: number;
  warnBelowCost: boolean;
  notifications: Record<NotificationKind, boolean>;
}

/** PUT /api/v1/settings — needs a fresh sign-in (`fresh_auth_required`). */
export type UpdateNetworkSettingsRequest = Omit<NetworkSettings, 'networkName'>;

export interface CategoryMarkup {
  categoryId: string;
  categoryName: string;
  /** null — no markup of the category yet. */
  markupPercent: number | null;
  products: number;
}

/** PUT /api/v1/settings/markups */
export interface UpdateMarkupsRequest {
  markups: Array<{ categoryId: string; markupPercent: number }>;
}

/* ---------------- offline stores ---------------- */

/** GET /api/v1/sync/stores — the cloud view of the offline stores (`sync:view`). */
export interface OfflineStoreSync {
  storeId: string;
  storeName: string;
  lastSyncAt: string | null;
  /** Operations applied from the store during the last 24 hours. */
  appliedLastDay: number;
  /** Operations of the store that wait for a decision (ADR-0014 quarantine). */
  quarantined: number;
  licenseValidUntil: string | null;
  priceConflicts: number;
  pendingDuplicates: number;
}

export type OfflineQueueKind =
  'sale' | 'return' | 'write_off' | 'price_change' | 'new_product' | 'shift';

export interface OfflineQueueItem {
  id: string;
  at: string;
  kind: OfflineQueueKind;
  label: string;
  amountMinor: number | null;
}

/** GET /api/v1/sync/queue — on an offline store: operations waiting for the cloud. */
export type OfflineQueueResponse = Page<OfflineQueueItem>;

/** POST /api/v1/sync/runs — on an offline store, `sync:run`. */
export interface SyncRunResult {
  sent: number;
  received: number;
  finishedAt: string;
}

/** POST /api/v1/catalog/duplicates/{id}/resolve — only on the offline store that added it. */
export interface ResolveDuplicateRequest {
  decision: 'merge' | 'keep';
}
