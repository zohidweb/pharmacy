/*
 * REST contract of the stock (ТЗ «Склад», UI mockups «Остатки», «Приход», «Перемещения»,
 * «Списание», «Возврат поставщику», «Инвентаризация»). Stock is never stored: it is derived from
 * movements by batch, and a posted document writes its movements in one transaction (CLAUDE.md).
 * Amounts are integer dirams, TJS only (ADR-0016) — no currencies or exchange rates. Purchase
 * prices are sent only with `finance:view-cost` (ADR-0018, п. 6): the fields are absent otherwise.
 * Stock of an offline store is read-only from the cloud (ADR-0014): writes answer 409
 * `offline_store_read_only`.
 */
import type { StockState } from '@pharmacy/shared-domain';
import type { Page, StoreMode } from './platform-tenants.js';
import type { PrescriptionKind, SaleUnit } from './tenant-pos.js';

export type DocumentStatus = 'draft' | 'posted';

export interface DocumentAuthor {
  name: string;
  at: string;
}

/** Common filters of document journals: limit/offset paging. */
export interface DocumentListQuery {
  storeId?: string;
  status?: DocumentStatus;
  supplierId?: string;
  reason?: string;
  limit?: number;
  offset?: number;
}

export interface StockBatch {
  id: string;
  number: string;
  /** YYYY-MM-DD */
  expiresOn: string;
  quantityPieces: number;
  /** Purchase price of a pack; only with `finance:view-cost`. */
  costMinor?: number;
}

/** GET /api/v1/stores/{storeId}/stock-products?query=&limit= — products for document lines. */
export interface StockProductOption {
  id: string;
  name: string;
  barcodes: string[];
  categoryId: string;
  piecesPerPack: number;
  divisible: boolean;
  prescription: PrescriptionKind;
  /** Price of a pack at the store; null — not sold there yet. */
  retailPriceMinor: number | null;
  /** Markup of the product or its category, whole percent; null — none. */
  markupPercent: number | null;
  minStockPacks: number;
  /** Batches of the store with stock, earliest expiry first (FEFO). */
  batches: StockBatch[];
}

export type StockStateFilter = 'all' | 'low' | 'expiring' | 'out' | 'negative';
export type StockSortKey = 'product' | 'expiresOn' | 'quantity' | 'price';

/** GET /api/v1/stock?storeId=&q=&state=&sort=&direction=&limit=&offset= — one row per batch. */
export interface StockListQuery {
  /** Without it — every store of the employee scope. */
  storeId?: string;
  q?: string;
  state?: StockStateFilter;
  sort?: StockSortKey;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface StockRow {
  /** Batch id, or the product id for a product without stock. */
  id: string;
  productId: string;
  productName: string;
  barcode: string | null;
  prescription: PrescriptionKind;
  storeId: string;
  storeName: string;
  storeMode: StoreMode;
  batchId: string | null;
  batchNumber: string | null;
  expiresOn: string | null;
  /** Negative only after merging an offline store («продажа — факт», ADR-0014). */
  quantityPieces: number;
  piecesPerPack: number;
  minPieces: number;
  costMinor?: number;
  /** Price of a pack at the store; null — not sold there. */
  retailPriceMinor: number | null;
  state: StockState;
}

export interface StockListResponse extends Page<StockRow> {
  counts: { low: number; expiring: number; negative: number };
}

/** GET /api/v1/suppliers/options — minimal list for documents (the full card is «Поставщики»). */
export interface SupplierOption {
  id: string;
  name: string;
}

export interface PurchaseOrderLineOption {
  productId: string;
  productName: string;
  quantity: number;
  receivedQuantity: number;
  priceMinor: number;
}

/** GET /api/v1/purchase-orders/open?supplierId= — confirmed or partially received orders. */
export interface PurchaseOrderOption {
  id: string;
  number: string;
  supplierId: string;
  status: 'confirmed' | 'partially_received';
  lines: PurchaseOrderLineOption[];
}

/** GET /api/v1/stock-documents/{kind}/{id}/unposting-check — whether a posted document can be unposted. */
export interface UnpostCheck {
  allowed: boolean;
  postedBy: DocumentAuthor | null;
  /** Batches with later movements: unposting would make the stock negative (ТЗ). */
  blockers: Array<{
    productName: string;
    batchNumber: string;
    soldPieces: number;
    documents: string[];
  }>;
}

export type StockDocumentKind =
  | 'goods-receipts'
  | 'opening-balances'
  | 'write-offs'
  | 'supplier-returns'
  | 'stock-counts';

/** GET /api/v1/stock/products/{productId}/batches — batches with stock in the stores of the scope. */
export interface ProductBatchRow {
  storeId: string;
  storeName: string;
  batchId: string;
  /** Lot number of the batch; empty without one. */
  batchNumber: string;
  /** YYYY-MM-DD */
  expiresOn: string;
  quantityPieces: number;
  /** Purchase price of a pack; only with `finance:view-cost`. */
  costMinor?: number;
}

/* ---------------- Goods receipt (ПР) ---------------- */

export interface GoodsReceiptLine {
  productId: string;
  productName: string;
  batchNumber: string;
  expiresOn: string;
  /** Packs. */
  quantity: number;
  /** Price in the purchase order, per pack; null without an order. */
  orderPriceMinor: number | null;
  /** Actual purchase price per pack (from the invoice). */
  costMinor: number;
  /** New retail price of a pack: proposed by the markup, edited before posting. */
  retailPriceMinor: number;
}

/**
 * One goods receipt = one supplier and one invoice (ТЗ). Posting writes the batches, the stock
 * movements, the prices of the store (`pricing:update-store`/`update-network`) and the debt to the
 * supplier in one transaction. 403 `forbidden` / `store_not_in_scope`; 409 `document_posted`,
 * `unpost_blocked`, `offline_store_read_only`, `product_archived`; 422 `validation_failed`,
 * `period_closed`, `above_max_price` (fields `lines.<i>.<field>`, `date`).
 */
export interface GoodsReceipt {
  id: string;
  number: string;
  status: DocumentStatus;
  /** YYYY-MM-DD */
  date: string;
  supplierId: string;
  supplierName: string;
  storeId: string;
  storeName: string;
  orderId: string | null;
  orderNumber: string | null;
  invoiceNumber: string;
  paymentDueOn: string | null;
  lines: GoodsReceiptLine[];
  totalMinor: number;
  createdBy: DocumentAuthor;
  postedBy: DocumentAuthor | null;
}

export type GoodsReceiptInput = Pick<
  GoodsReceipt,
  | 'date'
  | 'supplierId'
  | 'storeId'
  | 'orderId'
  | 'invoiceNumber'
  | 'paymentDueOn'
> & { lines: Array<Omit<GoodsReceiptLine, 'productName'>> };

export interface GoodsReceiptListItem {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  orderNumber: string | null;
  storeName: string;
  positions: number;
  totalMinor?: number;
  status: DocumentStatus;
}

export interface GoodsReceiptListResponse extends Page<GoodsReceiptListItem> {
  kpi: {
    postedThisMonth: number;
    postedThisMonthMinor?: number;
    drafts: number;
  };
}

/* ---------------- Opening balance (НО) ---------------- */

/**
 * A line of the opening balance: stock that was on the shelf before the system. The retail price
 * is optional — null keeps the price of the store as it is.
 */
export interface OpeningBalanceLine {
  productId: string;
  productName: string;
  batchNumber: string;
  /** YYYY-MM-DD */
  expiresOn: string;
  /** Packs. */
  quantity: number;
  /** Purchase price per pack. */
  costMinor: number;
  retailPriceMinor: number | null;
  /** «Стартовая партия» without a split by lots (ТЗ КП 3.4). */
  starting: boolean;
}

/**
 * GET/POST/PUT /api/v1/opening-balances, POST …/{id}/posting, …/unposting — like a goods receipt,
 * without a supplier, an invoice and a debt. Errors as for goods receipts.
 */
export interface OpeningBalance {
  id: string;
  number: string;
  status: DocumentStatus;
  /** YYYY-MM-DD */
  date: string;
  storeId: string;
  storeName: string;
  comment: string;
  lines: OpeningBalanceLine[];
  totalMinor: number;
  createdBy: DocumentAuthor;
  postedBy: DocumentAuthor | null;
}

export type OpeningBalanceInput = Pick<
  OpeningBalance,
  'date' | 'storeId' | 'comment'
> & { lines: Array<Omit<OpeningBalanceLine, 'productName'>> };

export interface OpeningBalanceListItem {
  id: string;
  number: string;
  date: string;
  storeName: string;
  positions: number;
  totalMinor?: number;
  status: DocumentStatus;
}

/** GET /api/v1/opening-balances?storeId=&status=&limit=&offset= */
export type OpeningBalanceListResponse = Page<OpeningBalanceListItem>;

/* ---------------- Write-off (СП) ---------------- */

export type WriteOffReason =
  'expired' | 'broken' | 'defect' | 'misgrade' | 'transfer_discrepancy';

export interface StockLine {
  productId: string;
  productName: string;
  batchId: string;
  batchNumber: string;
  expiresOn: string;
  unit: SaleUnit;
  quantity: number;
  /** Cost of the unit (pack or piece, rounded up); only with `finance:view-cost`. */
  costMinor?: number;
}

export interface WriteOff {
  id: string;
  number: string;
  status: DocumentStatus;
  date: string;
  storeId: string;
  storeName: string;
  reason: WriteOffReason;
  comment: string;
  lines: StockLine[];
  totalMinor?: number;
  createdBy: DocumentAuthor;
  postedBy: DocumentAuthor | null;
}

export type StockLineInput = Pick<
  StockLine,
  'productId' | 'batchId' | 'unit' | 'quantity'
>;

export interface WriteOffInput {
  date: string;
  storeId: string;
  reason: WriteOffReason;
  comment: string;
  lines: StockLineInput[];
}

export interface WriteOffListItem {
  id: string;
  number: string;
  date: string;
  storeName: string;
  reason: WriteOffReason;
  positions: number;
  totalMinor?: number;
  postedByName: string | null;
  status: DocumentStatus;
}

export interface WriteOffListResponse extends Page<WriteOffListItem> {
  kpi: {
    documentsThisMonth: number;
    writtenOffThisMonthMinor?: number;
    expiredBatches: number;
    expiringBatches: number;
  };
}

/* ---------------- Supplier return (ВП) ---------------- */

export type SupplierReturnReason = 'defect' | 'expired' | 'broken';
export type ClaimStatus = 'none' | 'draft' | 'sent' | 'accepted';

export interface SupplierReturnLine extends StockLine {
  /** Why this line goes back (e.g. «повреждена упаковка»). */
  note: string;
}

/** Posting writes the stock off and lowers the debt to the supplier by the amount (ТЗ). */
export interface SupplierReturn {
  id: string;
  number: string;
  status: DocumentStatus;
  date: string;
  supplierId: string;
  supplierName: string;
  storeId: string;
  storeName: string;
  receiptId: string | null;
  receiptNumber: string | null;
  reason: SupplierReturnReason;
  claim: ClaimStatus;
  lines: SupplierReturnLine[];
  totalMinor?: number;
  createdBy: DocumentAuthor;
  postedBy: DocumentAuthor | null;
}

export interface SupplierReturnInput {
  date: string;
  supplierId: string;
  storeId: string;
  receiptId: string | null;
  reason: SupplierReturnReason;
  createClaim: boolean;
  lines: Array<StockLineInput & { note: string }>;
}

export interface SupplierReturnListItem {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  receiptNumber: string | null;
  storeName: string;
  reason: SupplierReturnReason;
  totalMinor?: number;
  claim: ClaimStatus;
  status: DocumentStatus;
}

export interface SupplierReturnListResponse extends Page<SupplierReturnListItem> {
  kpi: {
    documentsThisMonth: number;
    returnedThisMonthMinor?: number;
    openClaims: number;
  };
}

/* ---------------- Stock count (ИН) ---------------- */

export type StockCountScope = 'all' | 'category' | 'selected';

export interface StockCountLine {
  productId: string;
  productName: string;
  batchId: string;
  batchNumber: string;
  expiresOn: string;
  piecesPerPack: number;
  /** Book stock at the start, pieces. */
  bookPieces: number;
  /** Sold since the start: the POS keeps working during the count (ТЗ). */
  soldSincePieces: number;
  /** Counted, pieces; null until entered. */
  factPieces: number | null;
  /** Cost of a piece (rounded up); only with `finance:view-cost`. */
  pieceCostMinor?: number;
}

export interface StockCount {
  id: string;
  number: string;
  status: 'in_progress' | 'posted';
  startedAt: string;
  storeId: string;
  storeName: string;
  scope: StockCountScope;
  categoryId: string | null;
  categoryName: string | null;
  comment: string;
  lines: StockCountLine[];
  createdBy: DocumentAuthor;
  postedBy: DocumentAuthor | null;
}

/** POST /api/v1/stock-counts — the book stock is taken at this moment. */
export interface StartStockCountRequest {
  storeId: string;
  scope: StockCountScope;
  categoryId: string | null;
  productIds: string[];
}

/** PUT /api/v1/stock-counts/{id} — counted quantities; posting: surplus in, shortage off (ТЗ). */
export interface SaveStockCountRequest {
  comment: string;
  facts: Array<{ batchId: string; factPieces: number | null }>;
}

export interface StockCountListItem {
  id: string;
  number: string;
  startedAt: string;
  storeName: string;
  scope: StockCountScope;
  categoryName: string | null;
  positions: number;
  surplusLines: number;
  shortageLines: number;
  diffMinor?: number;
  status: StockCount['status'];
}

/* ---------------- Transfers (ЗП / ПМ) ---------------- */

export type TransferRequestStatus =
  'draft' | 'sent' | 'in_progress' | 'partial' | 'done' | 'rejected';

export type RejectionReason = 'no_stock' | 'order_from_supplier' | 'other';

export interface TransferRequest {
  id: string;
  number: string;
  date: string;
  requesterStoreId: string;
  requesterStoreName: string;
  fromStoreId: string;
  fromStoreName: string;
  status: TransferRequestStatus;
  lines: Array<{ productId: string; productName: string; quantity: number }>;
  comment: string;
  rejection: { reason: RejectionReason; comment: string } | null;
}

/** POST /api/v1/transfer-requests — a draft or sent at once. */
export interface TransferRequestInput {
  fromStoreId: string;
  toStoreId: string;
  comment: string;
  send: boolean;
  lines: Array<{ productId: string; quantity: number }>;
}

/**
 * in_transit — sent; awaiting — arrived at an offline store, its confirmation comes with the sync
 * (ADR-0014); accepted — confirmed by the receiver with the actual quantities.
 */
export type TransferStatus = 'draft' | 'in_transit' | 'awaiting' | 'accepted';

export interface TransferLine {
  productId: string;
  productName: string;
  batchId: string;
  batchNumber: string;
  expiresOn: string;
  /** Packs sent. */
  sentQuantity: number;
  /** Packs received; null until the receiver confirms. */
  receivedQuantity: number | null;
}

export type DiscrepancyResolution = 'write_off' | 'resend';

export interface Transfer {
  id: string;
  number: string;
  date: string;
  requestId: string | null;
  requestNumber: string | null;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  status: TransferStatus;
  lines: TransferLine[];
  sentBy: DocumentAuthor | null;
  receivedBy: DocumentAuthor | null;
  /** A shortage at acceptance; until resolved the missing packs stay «в пути». */
  discrepancy: {
    comment: string;
    resolution: DiscrepancyResolution | null;
    /** СП or ПМ created by the resolution. */
    documentNumber: string | null;
  } | null;
}

/** POST /api/v1/transfers — FEFO batches within the sender stock (picked from a request or new). */
export interface TransferInput {
  requestId: string | null;
  fromStoreId: string;
  toStoreId: string;
  send: boolean;
  lines: Array<{ productId: string; batchId: string; quantity: number }>;
}

/** POST /api/v1/transfers/{id}/acceptance — `inventory:receive`: the store stock changes only now. */
export interface AcceptTransferRequest {
  comment: string;
  lines: Array<{ batchId: string; receivedQuantity: number }>;
}

export interface TransferListItem {
  id: string;
  number: string;
  date: string;
  fromStoreName: string;
  toStoreName: string;
  requestNumber: string | null;
  positions: number;
  status: TransferStatus;
  sentByName: string | null;
  openDiscrepancy: boolean;
}

export interface TransferOverview {
  requests: TransferRequest[];
  transfers: TransferListItem[];
  kpi: {
    newRequests: number;
    requestsInProgress: number;
    inTransit: number;
    awaiting: number;
    openDiscrepancies: number;
  };
}
