/*
 * REST contract of the owner cabinet (ТЗ «Кабинет владельца», UI mockups «Точки, услуги, оплата»,
 * «Отчёты», «Настройки», «Офлайн-точка»). Amounts are integer dirams, TJS only (ADR-0016) — no
 * exchange rates. The owner creates stores and their legal entities (spec 2026-10-06-owner-stores);
 * closing a store moves its stock by a transfer and completes when the receiver accepts it. Offline stores (ADR-0014):
 * the cloud shows their synchronisation; an offline store decides its product duplicates itself.
 */
import type { Page, StoreMode } from './platform-tenants.js';

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
  /** `pending` — an offline kit is issued (mode offline_pending); `closing` is not used yet. */
  status: OwnerStoreStatus;
  /** Cloud store: paid until; null until billing for the owner exists. */
  paidUntil: string | null;
  /** Offline store: the license key is valid until; null until offline stores exist. */
  licenseValidUntil: string | null;
  /** 0 until the POS module exists. */
  receiptsThisMonth: number;
  /** YYYY-MM-DD of a closed store. */
  closedOn: string | null;
  /** A closed store: where its stock went (null until store closing exists). */
  stockMovedTo: string | null;
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

/** GET /api/v1/stores/{id}/closing-preview — the stock that moves to the receiver. */
export interface StoreClosingPreview {
  lines: StoreClosingLine[];
  positions: number;
  totalCostMinor?: number;
}

/** POST /api/v1/stores/{id}/closing — creates the transfer; the store closes on its acceptance. */
export interface CloseStoreRequest {
  receiverStoreId: string;
  /** YYYY-MM-DD */
  closeOn: string;
}

export interface CloseStoreResponse {
  transferNumber: string;
  store: OwnerStore;
}

/* ---------------- services and billing ---------------- */

export type TenantServiceKey =
  'export-1c' | 'fiscal' | 'notifications' | 'print-agent' | 'labels';

export type TenantServiceState = 'included' | 'requested' | 'available';

export interface TenantService {
  key: TenantServiceKey;
  state: TenantServiceState;
  requestedAt: string | null;
}

export type TenantInvoiceStatus = 'paid' | 'due' | 'overdue';

export interface TenantInvoice {
  number: string;
  /** YYYY-MM */
  period: string;
  amountMinor: number;
  dueOn: string;
  paidOn: string | null;
  status: TenantInvoiceStatus;
}

/** GET /api/v1/billing — a store with at least one sale in the month is active for billing. */
export interface TenantBilling {
  current: TenantInvoice & {
    activeStores: number;
    pricePerStoreMinor: number;
  };
  history: TenantInvoice[];
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
  | 'controlled';

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
  | 'reason';

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
 * are absent without `finance:view-cost` (ADR-0018, п. 6).
 */
export interface ReportTable {
  kind: ReportKind;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  total: Record<string, ReportCell> | null;
}

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

export type NotificationKind =
  | 'expiry'
  | 'low_stock'
  | 'supplier_debt'
  | 'transfer'
  | 'shift_discrepancy'
  | 'sync_conflict'
  | 'negative_stock'
  | 'license_expiry';

/** GET/PUT /api/v1/settings — network settings; every change goes to the audit log. */
export interface NetworkSettings {
  networkName: string;
  returnWindowDays: number;
  /** Cashier session timeout on the terminal, minutes (CLAUDE.md «Security constraints»). */
  posSessionTimeoutMinutes: number;
  /** ≥ 4 (ADR-0008). */
  minPinLength: number;
  expiryNoticeDays: number;
  warnBelowCost: boolean;
  notifications: Record<NotificationKind, boolean>;
}

export interface CategoryMarkup {
  categoryId: string;
  categoryName: string;
  markupPercent: number;
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
