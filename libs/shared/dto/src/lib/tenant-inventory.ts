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

/** GET /api/v1/stores/{storeId}/stock-products?query=&limit=&expired= */
export interface StockProductsQuery {
  query?: string;
  /** 1–500; ignored with `expired`. */
  limit?: number;
  /**
   * Only the batches with stock > 0 that expired before the business date, of every product of the
   * store including archived ones; no search and no page limit («добавить просроченные партии»).
   */
  expired?: boolean;
  /**
   * Comma-separated ids (≤ 500): exactly these products, archived ones too, with their batches in
   * stock — to reopen the lines of a saved document. No search and no page limit.
   */
  ids?: string;
  /**
   * Only the batches of this supplier. A search (`query` / `limit`) looks among the products with
   * the supplier's batches in stock; with `ids` (the lines of a supplier return) every product stays,
   * with the supplier's batches only.
   */
  supplierId?: string;
  /**
   * Only the batches created by this goods receipt that are still in stock, of any product status;
   * no search and no page limit («добавить из прихода» of a supplier return — reading the receipt
   * itself needs `finance:view-cost`).
   */
  receiptId?: string;
}

/** GET /api/v1/stores/{storeId}/stock-products — products for document lines. */
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
  /** Regulated maximum retail price of a pack; null — not regulated. */
  maxPriceMinor: number | null;
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

/** GET /api/v1/stock/reorder?storeId= (`inventory:view`) — «Надо заказать», the menu counter «Остатки». */
export interface ReorderQuery {
  /** Without it — every active store of the employee scope; outside it — 403 `store_not_in_scope`. */
  storeId?: string;
}

/**
 * A product below its minimum at a store (the rule of the home tile «Мало на складе»: the assortment
 * of the store, an active product with a minimum, stock below it — an ended product included). Sorted
 * by store, then by product name.
 */
export interface ReorderLine {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  /** Not negative: an ended product has 0. */
  stockPieces: number;
  minPieces: number;
  /** `minPieces − stockPieces`. */
  shortagePieces: number;
  piecesPerPack: number;
}

/** GET /api/v1/suppliers/options — minimal list for documents (the full card is «Поставщики»). */
export interface SupplierOption {
  id: string;
  name: string;
  /** The payment deferral: a goods receipt without a due date is due on its date + these days. */
  paymentDelayDays: number;
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
  | 'expired'
  | 'broken'
  | 'defect'
  | 'misgrade'
  | 'transfer_discrepancy'
  // system reasons of the write-off of a customer return (spec 2026-10-13-customer-returns, E9):
  // not chosen by hand
  | 'customer_return_defect'
  | 'customer_return_expired';

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

/**
 * GET /api/v1/write-offs/{id}. Posting (`POST …/posting`, `inventory:post`) writes the batches off:
 * 409 `stock_insufficient` (errors at `lines.i.quantity`), 422 `validation_failed` (date) /
 * `period_closed`; unposting (`POST …/unposting`, `inventory:unpost`) — 409 `unpost_blocked` when a
 * batch moved after the posting. Amounts only with `finance:view-cost`.
 */
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
  /**
   * The transfer whose shortage this write-off records (made by the acceptance, spec T6): it is
   * not edited, posted or unposted by hand — 409 `write_off_from_transfer`.
   */
  transferId: string | null;
  transferNumber: string | null;
  /**
   * The customer return whose defect or expired batch this write-off records (E9): made by the
   * return, never edited, posted or unposted by hand — 409 `write_off_from_return`.
   */
  customerReturnId: string | null;
  customerReturnNumber: string | null;
}

export type StockLineInput = Pick<
  StockLine,
  'productId' | 'batchId' | 'unit' | 'quantity'
>;

/**
 * POST /api/v1/write-offs (`inventory:create`), PUT /api/v1/write-offs/{id} (`inventory:update`,
 * a draft only — 409 `document_posted`); no cost right needed. 400 at `lines.i.batchId` (a batch of
 * another store or product, a repeated batch), `lines.i.unit` (pieces of an indivisible product).
 */
export interface WriteOffInput {
  date: string;
  storeId: string;
  reason: WriteOffReason;
  comment: string;
  lines: StockLineInput[];
}

/** GET /api/v1/write-offs?storeId=&reason=&status=&limit=&offset= */
export interface WriteOffListQuery {
  storeId?: string;
  reason?: WriteOffReason;
  status?: DocumentStatus;
  limit?: number;
  offset?: number;
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

export interface SupplierReturnLine extends StockLine {
  /** Why this line goes back (e.g. «повреждена упаковка»). */
  note: string;
}

/**
 * GET /api/v1/supplier-returns/{id}. Posting (`POST …/posting`, `inventory:post`) takes the batches
 * off the stock and credits the supplier with their purchase cost: the credit covers the receipts
 * of the batches first, then the other open receipts; the rest goes to the next receipt. 409
 * `stock_insufficient` (errors at `lines.i.quantity`) / `stock_count_in_progress`, 422
 * `validation_failed` (date) / `period_closed`. Unposting (`POST …/unposting`, `inventory:unpost`) —
 * 409 `unpost_blocked` when a batch moved after the posting. Amounts only with `finance:view-cost`;
 * the claim to the supplier is the comment (spec 2026-10-12-supplier-returns-transfers, R7).
 */
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
  comment: string;
  lines: SupplierReturnLine[];
  totalMinor?: number;
  createdBy: DocumentAuthor;
  postedBy: DocumentAuthor | null;
}

/**
 * POST / PUT /api/v1/supplier-returns — a draft (`inventory:create` / `inventory:update`): 400 at
 * `lines.i.batchId` (`wrong_supplier` — a batch of another supplier), `supplierId`
 * (`unknown_supplier` — unknown or archived), `receiptId` (not a posted receipt of the supplier at the
 * store); 409 `document_posted`.
 */
export interface SupplierReturnInput {
  date: string;
  supplierId: string;
  storeId: string;
  /** A posted goods receipt of the supplier at the store, to fill the lines from; optional. */
  receiptId: string | null;
  reason: SupplierReturnReason;
  /** ≤ 500; the claim to the supplier. */
  comment: string;
  /** `note` ≤ 200. */
  lines: Array<StockLineInput & { note: string }>;
}

export interface SupplierReturnListQuery {
  storeId?: string;
  supplierId?: string;
  reason?: SupplierReturnReason;
  status?: DocumentStatus;
  limit?: number;
  offset?: number;
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
  status: DocumentStatus;
}

export interface SupplierReturnListResponse extends Page<SupplierReturnListItem> {
  kpi: {
    documentsThisMonth: number;
    returnedThisMonthMinor?: number;
  };
}

/* ---------------- Stock count (ИН) ---------------- */

/** «Выборочно» is out of this iteration (spec 2026-10-12, S3). */
export type StockCountScope = 'all' | 'category';

/** «Counted N pieces» of a line by one employee; the fact of the line is the sum of its entries. */
export interface StockCountEntry {
  id: string;
  /** May be 0 («counted none») or negative (a correction). */
  pieces: number;
  byName: string;
  /** Entered by the current employee (they may delete it). */
  mine: boolean;
  at: string;
}

export interface StockCountLine {
  lineId: string;
  productId: string;
  productName: string;
  /** For the scanner. */
  barcodes: string[];
  /** A product found without a book batch (spec S1); a new batch is created on posting. */
  isFound: boolean;
  /** null for a found product. */
  batchId: string | null;
  batchNumber: string;
  /** null for a found product until entered. */
  expiresOn: string | null;
  piecesPerPack: number;
  /** Book stock at the start, pieces; 0 for a found product. */
  bookPieces: number;
  /**
   * Sold between the start and the first entry of the line (POS sales minus returns, by the moment
   * of the sale): the expected stock is the book minus it (spec 2026-10-13-pos-shift-sale, K2).
   */
  soldBeforeCountPieces: number;
  /** Sold after the first entry: counted already, shown for the manager (K2). */
  soldAfterCountPieces: number;
  /** Has at least one entry. */
  counted: boolean;
  /** Sum of the entries, pieces; null until counted. */
  factPieces: number | null;
  entries: StockCountEntry[];
  /** Cost of a piece (rounded up); only with `finance:view-cost`. */
  pieceCostMinor?: number;
  /** Purchase price of a pack of a found product; only with `finance:view-cost`. */
  costMinor?: number | null;
}

/**
 * GET /api/v1/stock-counts/{id}. Posting (`POST …/posting`, `inventory:post`): 422
 * `validation_failed` at `lines.i.counted` / `lines.i.expiresOn` / `lines.i.costMinor`,
 * `period_closed`; unposting (`POST …/unposting`, `inventory:unpost`): 409 `unpost_blocked`,
 * `stock_count_in_progress`; cancellation (`POST …/cancellation`, `inventory:delete`): only in
 * progress, 409 `document_posted` / `document_cancelled`.
 */
/**
 * GET /api/v1/stock-counts/{id}/version (`inventory:view`): a fingerprint of everything the count
 * shows — the status and comment, the lines, the entries of every tablet and the movements of its
 * batches (sales during the count). A running count polls it and reloads the document only when it
 * changed (cnt-poll, decided 2026-10-16).
 */
export interface StockCountVersion {
  version: string;
}

export interface StockCount {
  id: string;
  number: string;
  status: 'in_progress' | 'posted' | 'cancelled';
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
  cancelledBy: DocumentAuthor | null;
}

/**
 * POST /api/v1/stock-counts (`inventory:post`) — the book stock is taken at this moment; the stock
 * of the scope is frozen for stock documents of the store until posting or cancellation. 409
 * `stock_count_in_progress` when the store already has a running count.
 */
export interface StartStockCountRequest {
  storeId: string;
  scope: StockCountScope;
  /** Required for the scope `category`, null otherwise. */
  categoryId: string | null;
}

/** PUT /api/v1/stock-counts/{id} (`inventory:update`) — the comment of a running count. */
export interface SaveStockCountRequest {
  comment: string;
}

/**
 * POST /api/v1/stock-counts/{id}/entries (`inventory:update`) — `id` (UUIDv7 of the tablet) is the
 * idempotency key: a repeat returns the same line, another body with it — 409
 * `idempotency_conflict`. DELETE …/entries/{entryId} — one's own entry, another one's with
 * `inventory:post`.
 */
export interface StockCountEntryRequest {
  id: string;
  lineId: string;
  pieces: number;
}

/**
 * POST /api/v1/stock-counts/{id}/found-lines, PUT …/found-lines/{lineId} (`inventory:update`) — a
 * product found without a book batch; `costMinor` (a pack) only with `finance:view-cost`. An
 * archived product — 409 `product_archived`. DELETE — while the line has no entries.
 */
export interface FoundLineInput {
  productId: string;
  batchNumber: string;
  expiresOn: string | null;
  costMinor: number | null;
}

/** GET /api/v1/stock-counts?storeId=&status=&limit=&offset= */
export interface StockCountListQuery {
  storeId?: string;
  status?: StockCount['status'];
  limit?: number;
  offset?: number;
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

/**
 * draft → sent → in_progress (a transfer draft is made by it) → done / partial (the transfer is
 * sent: all or less than asked) or rejected. One request — one transfer (spec
 * 2026-10-12-supplier-returns-transfers, T2).
 */
export type TransferRequestStatus =
  'draft' | 'sent' | 'in_progress' | 'partial' | 'done' | 'rejected';

export type RejectionReason = 'no_stock' | 'order_from_supplier' | 'other';

export interface TransferRequest {
  id: string;
  number: string;
  /** Business date of the creation, YYYY-MM-DD. */
  date: string;
  /** The store that needs the goods (the receiver). */
  requesterStoreId: string;
  requesterStoreName: string;
  /** The store asked to send them. */
  fromStoreId: string;
  fromStoreName: string;
  status: TransferRequestStatus;
  /** Packs. */
  lines: Array<{ productId: string; productName: string; quantity: number }>;
  comment: string;
  rejection: { reason: RejectionReason; comment: string } | null;
  /** The not cancelled transfer by the request. */
  transferId: string | null;
  transferNumber: string | null;
}

/**
 * POST /api/v1/transfer-requests, PUT /api/v1/transfer-requests/{id} (a draft) — `inventory:create`
 * / `inventory:update`; `send` sends it at once. 400 at `lines.i.productId` (`duplicate`,
 * `product_archived`); 409 `offline_store_read_only` / `document_posted`. DELETE — a draft only;
 * POST …/{id}/sending — `draft` → `sent`.
 */
export interface TransferRequestInput {
  fromStoreId: string;
  /** The requesting store. */
  toStoreId: string;
  comment: string;
  send: boolean;
  /** Packs, 1–100 000. */
  lines: Array<{ productId: string; quantity: number }>;
}

/**
 * POST /api/v1/transfer-requests/{id}/rejection — `inventory:post` of the asked store: a `sent` or
 * `in_progress` request (its transfer draft is cancelled); `comment` is required for `other`.
 * 409 `request_not_open`.
 */
export interface RejectTransferRequest {
  reason: RejectionReason;
  comment: string;
}

/**
 * in_transit — sent (the sender's stock went down); awaiting — sent to an offline store, confirmed
 * with the sync (ADR-0014; not served by the API yet); accepted — confirmed by the receiver with
 * the actual quantities; cancelled — a draft dropped (it may have been sent and recalled).
 */
export type TransferStatus =
  'draft' | 'in_transit' | 'awaiting' | 'accepted' | 'cancelled';

export interface TransferLine {
  productId: string;
  productName: string;
  batchId: string;
  batchNumber: string;
  expiresOn: string;
  /** The unit of the quantities of the line. */
  unit: SaleUnit;
  sentQuantity: number;
  /** Null until the receiver confirms. */
  receivedQuantity: number | null;
}

export interface Transfer {
  id: string;
  number: string;
  /** Business date of the dispatch (of the creation while a draft). */
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
  /**
   * A shortage at acceptance: the sender's write-off (`transfer_discrepancy`) made by the system
   * (spec T6); the comment of the receiver.
   */
  discrepancy: {
    comment: string;
    writeOffId: string;
    writeOffNumber: string;
  } | null;
}

/**
 * POST /api/v1/transfers, PUT /api/v1/transfers/{id} (a draft) — `inventory:create` /
 * `inventory:update`; `send` (needs `inventory:post`) sends it at once. By a request: only its
 * products, not more than asked (400 `not_requested` / `exceeds_request` at the lines), 409
 * `request_not_open` / `request_has_transfer`. POST …/{id}/sending — `inventory:post`: 409
 * `stock_insufficient` (at `lines.i.quantity`) / `stock_count_in_progress`; …/recall —
 * `inventory:unpost`, `in_transit` → `draft`; …/cancellation — `inventory:delete`, a draft →
 * `cancelled`. Both stores — active cloud stores (409 `offline_store_read_only`).
 */
export interface TransferInput {
  requestId: string | null;
  fromStoreId: string;
  toStoreId: string;
  send: boolean;
  lines: Array<{
    productId: string;
    batchId: string;
    unit: SaleUnit;
    quantity: number;
  }>;
}

/**
 * POST /api/v1/transfers/{id}/acceptance — `inventory:receive` of the receiver: every line once,
 * 0…sent in the unit of the line; the receiver gets its own batches, a shortage becomes a posted
 * write-off of the sender. 409 `transfer_not_in_transit` / `stock_count_in_progress` /
 * `transfer_changed`.
 */
export interface AcceptTransferRequest {
  /**
   * `sentBy.at` of the card the quantities were filled from. A transfer recalled, changed and sent
   * again since then has another dispatch: 409 `transfer_changed`, the card is read again.
   */
  dispatchedAt: string;
  comment: string;
  lines: Array<{ batchId: string; receivedQuantity: number }>;
}

export interface TransferListItem {
  id: string;
  number: string;
  date: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  requestNumber: string | null;
  positions: number;
  status: TransferStatus;
  sentByName: string | null;
  /** Accepted with a shortage (written off at the sender). */
  shortage: boolean;
}

/**
 * GET /api/v1/transfers/overview?storeId= — the requests and transfers of the stores of the scope:
 * open ones and those closed in the last 30 days, newest first, ≤ 200 of each.
 */
export interface TransferOverview {
  requests: TransferRequest[];
  transfers: TransferListItem[];
  kpi: {
    /** Sent requests to my stores. */
    newRequests: number;
    requestsInProgress: number;
    /** In transit to or from my stores. */
    inTransit: number;
  };
  /** The active stores of the network, to pick the other side; the scope does not limit them. */
  stores: Array<{ id: string; name: string; mode: StoreMode }>;
}
