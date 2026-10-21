/*
 * Synchronization protocol of offline stores (ADR-0014; spec 2026-10-16-offline-sync). The store calls the
 * cloud with its license key `Authorization: Bearer phk_<keyId>_<secret>`; JSON camelCase, money in integer
 * dirams, ids are UUIDv7 made on the store. Rows of a payload repeat the columns of their tables in camelCase
 * without `tenantId`, `createdAt`, `receivedAt` and `recordedAt` (the cloud sets those).
 */

/**
 * State of the license of a store (spec E12): `expiring` — within `notify_before_days` of `validUntil`;
 * `revoked`, `expired`, `store_closed`, `tenant_blocked` — operations are still accepted for the grace days of
 * the platform; `revoked_hard` — nothing is accepted. Sent in every sync answer as `Pharmacy-License-Status`.
 */
export type LicenseStatus =
  | 'active'
  | 'expiring'
  | 'expired'
  | 'revoked'
  | 'revoked_hard'
  | 'store_closed'
  | 'tenant_blocked';

/** POST /api/v1/sync/runs — the handshake that opens a run of the store. */
export interface SyncHandshakeRequest {
  storeId: string;
  protocolVersion: number;
  appVersion: string;
  /** The last applied migration of the store database (telemetry only). */
  schemaVersion: string;
  /** The feed cursor of the store (the `cursor` of its last feed page); null before the first pull. */
  feedCursor: number | null;
  /** Operations of the outbox not yet sent. */
  outboxDepth: number;
  /** When the oldest unsent operation happened; null — the outbox is empty. */
  oldestPendingAt: string | null;
  /** The clock of the store PC (ISO), for the clock skew. */
  storeTime: string;
}

export interface SyncHandshakeResponse {
  syncRunId: string;
  license: { status: LicenseStatus; validUntil: string };
  minSupportedProtocol: number;
  recommendedProtocol: number;
  /** Limits of one batch (ADR-0014 §6): 500 operations, 2 MB of JSON after gzip is inflated. */
  limits: { maxOperations: number; maxBytes: number };
  serverTime: string;
  /** Operations of the store waiting in quarantine in the cloud. */
  quarantined: number;
}

/** Every type of operation of a store (spec 4.2). */
export type SyncOperationType =
  | 'receipt.completed'
  | 'return.completed'
  | 'document.posted'
  | 'transfer.dispatched'
  | 'transfer.accepted'
  | 'shift.opened'
  | 'shift.cash-collected'
  | 'shift.closed'
  | 'product.created-locally'
  | 'product.duplicate-resolved'
  | 'price.changed-locally'
  | 'terminal.bound'
  | 'terminal.revoked'
  | 'audit.recorded'
  | 'stock.checkpoint';

/** One fact of the store: one local transaction there, one tenant transaction in the cloud. */
export interface SyncOperation<P = unknown> {
  /** UUIDv7 — the idempotency key of the operation. */
  operationId: string;
  /** Order of the outbox of the store. */
  storeSeq: number;
  type: SyncOperationType;
  typeVersion: number;
  /** SHA-256 hex of the canonical JSON of `payload` (keys sorted, no spaces). */
  payloadHash: string;
  correlationId: string;
  /** The clock of the store; informative only. */
  occurredAt: string;
  actor: { employeeId: string | null; terminalId: string | null };
  payload: P;
}

/** POST /api/v1/sync/operations — `Idempotency-Key` equals `batchId`. */
export interface SyncEnvelope {
  protocolVersion: number;
  batchId: string;
  syncRunId: string;
  storeId: string;
  operations: SyncOperation[];
}

export type SyncOperationStatus =
  'applied' | 'duplicate' | 'quarantined' | 'rejected' | 'pending_dependency';

export interface SyncOperationResult {
  operationId: string;
  status: SyncOperationStatus;
  /** Code of the reason of `quarantined`, `rejected` and `pending_dependency`. */
  reason?: string;
}

export interface SyncBatchResponse {
  results: SyncOperationResult[];
}

/** POST /api/v1/sync/runs/{id}/complete — the outcome of a run as the store saw it. */
export interface SyncRunCompleteRequest {
  operationsSent: number;
  applied: number;
  duplicate: number;
  quarantined: number;
  rejected: number;
  pendingDependency: number;
  changesReceived: number;
  bytesSent: number;
  durationMs: number;
  /** Codes of client errors, at most 20. */
  clientErrors: string[];
}

/* ---------------- rows ---------------- */

export interface SyncMovementRow {
  id: string;
  storeId: string;
  batchId: string;
  qtyDeltaPieces: number;
  kind: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  businessDate: string;
  reversesMovementId: string | null;
}

/** A row of the audit journal of the store; `recordedAt` is the clock of the store. */
export interface SyncAuditRow {
  id: string;
  recordedAt: string;
  businessDate: string;
  employeeId: string | null;
  storeId: string | null;
  terminalId: string | null;
  correlationId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
}

export interface SyncReceiptRow {
  id: string;
  storeId: string;
  terminalId: string;
  shiftId: string;
  cashierId: string;
  number: string;
  soldAt: string;
  businessDate: string;
  subtotalDirams: number;
  discountRuleId: string | null;
  discountPercentBp: number;
  discountMinTotalDirams: number | null;
  discountDirams: number;
  totalDirams: number;
  cashTenderedDirams: number;
  changeDirams: number;
  discrepancyKinds: string[];
  correlationId: string;
  language: 'ru' | 'tj';
}

export interface SyncReceiptLineRow {
  id: string;
  receiptId: string;
  lineNo: number;
  productId: string;
  batchId: string;
  saleUnit: 'pack' | 'piece';
  piecesPerPack: number;
  qtyPieces: number;
  unitPriceDirams: number;
  lineAmountDirams: number;
  discountShareDirams: number;
  costDirams: number;
  batchChosenManually: boolean;
  shortfallPieces: number;
  currentPriceDirams: number | null;
}

export interface SyncPaymentRow {
  id: string;
  receiptId: string;
  kind: 'cash' | 'card' | 'qr' | 'nfc';
  amountDirams: number;
}

/** A ПКУ line; the prescription data of the note never leaves the store in logs. */
export interface SyncControlledRecordRow {
  id: string;
  receiptLineId: string;
  prescriptionFileId: string | null;
  prescriptionNote: Record<string, unknown> | null;
  recordedBy: string;
  recordedAt: string;
}

export interface SyncShiftOpenRow {
  id: string;
  storeId: string;
  terminalId: string;
  number: string;
  openedBy: string;
  openedAt: string;
  openingCashDirams: number;
  openedAuthorFlagged: boolean;
}

export interface SyncShiftCloseRow {
  id: string;
  closedBy: string;
  closedAt: string;
  closedAuthorFlagged: boolean;
  expectedCashDirams: number;
  countedCashDirams: number;
  discrepancyDirams: number;
  discrepancyReason: string | null;
  terminalTotals: Record<string, unknown> | null;
  zReport: Record<string, unknown>;
}

export interface SyncShiftCashRow {
  id: string;
  shiftId: string;
  kind: 'deposit' | 'withdrawal';
  amountDirams: number;
  reason: string;
  comment: string | null;
  employeeId: string;
  occurredAt: string;
  authorFlagged: boolean;
}

export interface SyncCustomerReturnRow {
  id: string;
  storeId: string;
  shiftId: string;
  terminalId: string;
  cashierId: string;
  receiptId: string;
  number: string;
  returnedAt: string;
  businessDate: string;
  reason: 'customer' | 'defect';
  foundWithoutReceipt: boolean;
  discountReturnedDirams: number;
  refundDirams: number;
  correlationId: string;
}

export interface SyncCustomerReturnLineRow {
  id: string;
  customerReturnId: string;
  receiptLineId: string;
  qtyPieces: number;
  amountDirams: number;
  discountShareDirams: number;
}

export interface SyncRefundRow {
  id: string;
  customerReturnId: string;
  kind: 'cash' | 'card' | 'qr' | 'nfc';
  amountDirams: number;
}

/** A posted write-off of the store: the header of `documents` (type `write_off`). */
export interface SyncDocumentRow {
  id: string;
  storeId: string;
  type: string;
  number: string;
  documentDate: string;
  status: string;
  comment: string | null;
  createdBy: string;
  postedAt: string | null;
  postedBy: string | null;
  writeOffReason: string | null;
  sourceCustomerReturnId: string | null;
}

export interface SyncWriteOffLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  productId: string;
  batchId: string;
  qtyPieces: number;
  unit: 'pack' | 'piece';
}

export interface SyncWriteOffDocument {
  document: SyncDocumentRow;
  lines: SyncWriteOffLineRow[];
  movements: SyncMovementRow[];
}

/** A terminal of the store; its device credential never leaves the store. */
export interface SyncTerminalRow {
  id: string;
  storeId: string;
  name: string;
  boundBy: string;
  boundAt: string;
}

/* ---------------- payloads of PR 1 ---------------- */

export interface ReceiptCompletedPayload {
  receipt: SyncReceiptRow;
  lines: SyncReceiptLineRow[];
  payments: SyncPaymentRow[];
  controlledRecords: SyncControlledRecordRow[];
  movements: SyncMovementRow[];
  audit: SyncAuditRow[];
}

export interface ReturnCompletedPayload {
  customerReturn: SyncCustomerReturnRow;
  lines: SyncCustomerReturnLineRow[];
  refunds: SyncRefundRow[];
  movements: SyncMovementRow[];
  /** The automatic write-off of defect or expired goods in the same transaction; null — none. */
  writeOff: SyncWriteOffDocument | null;
  audit: SyncAuditRow[];
}

export interface ShiftOpenedPayload {
  shift: SyncShiftOpenRow;
  audit: SyncAuditRow[];
}

export interface ShiftCashCollectedPayload {
  operation: SyncShiftCashRow;
  audit: SyncAuditRow[];
}

export interface ShiftClosedPayload {
  shift: SyncShiftCloseRow;
  audit: SyncAuditRow[];
}

export interface TerminalBoundPayload {
  terminal: SyncTerminalRow;
  /** The previous terminal of the same device, revoked by the binding; null — none. */
  revokedTerminalId: string | null;
  audit: SyncAuditRow[];
}

export interface TerminalRevokedPayload {
  terminalId: string;
  revokedAt: string;
  revokedBy: string;
  audit: SyncAuditRow[];
}

export interface AuditRecordedPayload {
  audit: SyncAuditRow;
}

/**
 * The stock of the store at the position `atStoreSeq` of its outbox (spec E19): batches with a non-zero stock,
 * their total pieces and SHA-256 hex of the lines `${batchId}:${onHand}\n` sorted by `batchId`.
 */
export interface StockCheckpointPayload {
  atStoreSeq: number;
  batches: number;
  totalPieces: number;
  hash: string;
}

/* ---------------- payloads of PR 2a: local prices and products ---------------- */

/** A name by language as the catalog stores it (`ru`, `tj`). */
export type SyncNameMap = Partial<Record<'ru' | 'tj', string>>;

/** A product created at the store (spec E26, E36): the card as the store wrote it, with its id. */
export interface SyncProductRow {
  id: string;
  name: SyncNameMap;
  inn: SyncNameMap | null;
  dosageForm: string | null;
  dosage: string | null;
  manufacturer: string | null;
  country: string | null;
  unit: string;
  piecesPerPack: number;
  soldByPiece: boolean;
  isPrescription: boolean;
  isControlled: boolean;
  isPriceRegulated: boolean;
  maxRetailPricePerPackDirams: number | null;
  categoryId: string;
  markupBp: number | null;
  defaultMinStockPieces: number | null;
  createdAtStoreId: string;
  /** The clock of the store. */
  createdAt: string;
}

export interface ProductCreatedLocallyPayload {
  product: SyncProductRow;
  barcodes: string[];
  /** The employee of the store who created the card. */
  createdBy: string;
  audit: SyncAuditRow[];
}

/**
 * The store's decision on a duplicate conflict (spec E26, E35): `merge` aliases its product to the card the
 * conflict found, `keep` leaves both cards (a taken barcode stays only at the store).
 */
export interface ProductDuplicateResolvedPayload {
  conflictId: string;
  productId: string;
  decision: 'merge' | 'keep';
  /** The card of the network for `merge`; null for `keep`. */
  mergedIntoProductId: string | null;
  resolvedBy: string;
  resolvedAt: string;
  audit: SyncAuditRow[];
}

/**
 * A retail price changed at the store (spec E25): applied when the cloud price is still the version the store
 * saw, otherwise the cloud price stays and a price conflict opens for the owner.
 */
export interface PriceChangedLocallyPayload {
  productId: string;
  storeId: string;
  retailPricePerPackDirams: number;
  retailPricePerPieceDirams: number | null;
  /**
   * The version of the price the store last received from the cloud (feed or snapshot); the store's own edits
   * never change it. Null — the store had no price of the product.
   */
  basePriceVersion: number | null;
  changedBy: string;
  changedAt: string;
  audit: SyncAuditRow[];
}

/* ---------------- payloads of PR 2b: stock documents ---------------- */

/** The header of a posted stock document of the store, with the fields of a goods receipt. */
export interface SyncStockDocumentRow extends SyncDocumentRow {
  supplierId: string | null;
  supplierInvoiceNumber: string | null;
  supplierInvoiceDate: string | null;
  paymentDueDate: string | null;
  purchaseOrderId: string | null;
  /**
   * The total of a goods receipt or opening balances as the store computed it (packs of its card × the price of a
   * pack) — the supplier invoice; of a stock count — Σ |pieces of its movements| × the cost of a piece of the batch;
   * of a supplier return — Σ of its line amounts. Null for a write-off (the cloud computes pieces × the cost of a
   * piece) and a product merge (no money).
   */
  totalDirams: number | null;
  supplierReturnReason: string | null;
  inventoryScope: string | null;
  inventoryCategoryId: string | null;
  inventoryStartedAt: string | null;
  /** A product merge (spec E35): the product of the store and the card of the network it was merged into. */
  mergeFromProductId: string | null;
  mergeIntoProductId:
    | string
    | null; /** A write-off `transfer_discrepancy` of an offline sender (spec E34): the transfer whose shortage it writes off. */
  sourceDocumentId: string | null;
}

export interface SyncGoodsReceiptLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  productId: string;
  /** The batch the posting created for the line. */
  batchId: string;
  expiryDate: string;
  lotNumber: string | null;
  qtyPieces: number;
  /** Pieces in a pack of the store's card at the posting (not stored: the total is checked with it). */
  piecesPerPack: number;
  purchasePricePerPackDirams: number;
  orderPricePerPackDirams: number | null;
  purchaseOrderLineId: string | null;
  retailPriceDraftDirams: number;
}

export interface SyncOpeningBalanceLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  productId: string;
  /** The batch the posting created for the line. */
  batchId: string;
  expiryDate: string;
  lotNumber: string | null;
  qtyPieces: number;
  /** Pieces in a pack of the store's card at the posting (not stored: the total is checked with it). */
  piecesPerPack: number;
  purchasePricePerPackDirams: number;
  retailPriceDraftDirams: number | null;
  supplierId: string | null;
  isStarting: boolean;
}

/** A batch the posting of the store created. */
export interface SyncBatchRow {
  id: string;
  storeId: string;
  productId: string;
  expiryDate: string;
  lotNumber: string | null;
  purchasePricePerPackDirams: number;
  costPerPieceDirams: number;
  supplierId: string | null;
  origin: string;
  sourceDocumentId: string;
  isStarting: boolean;
}

/** A line of a stock count: a batch of the store, or a found product (`isFound`) with its surplus batch. */
export interface SyncInventoryLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  productId: string;
  batchId: string | null;
  isFound: boolean;
  bookQtyPieces: number;
  countedQtyPieces: number;
  soldSinceStartPieces: number | null;
  soldAfterCountPieces: number | null;
  surplusBatchId: string | null;
  surplusExpiryDate: string | null;
  surplusLotNumber: string | null;
  surplusPurchasePricePerPackDirams: number | null;
}

export interface SyncSupplierReturnLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  productId: string;
  batchId: string;
  qtyPieces: number;
  unit: 'pack' | 'piece';
  /** Pieces in a pack of the store's card at the posting (not stored: the amount is checked with it). */
  piecesPerPack: number;
  amountDirams: number;
  note: string | null;
}

/** A line of a product merge (spec E35): the stock of a batch of the store's product moves to a new batch of the card. */
export interface SyncProductMergeLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  fromBatchId: string;
  toBatchId: string;
  qtyPieces: number;
}

/** A retail price a posting set at the store (spec E18): applied by the rule of `price.changed-locally`. */
export type SyncLocalPrice = Omit<PriceChangedLocallyPayload, 'audit'>;

/**
 * A stock document the store posted (spec 4.2): its header, the rows of the line table of `document.type`
 * (`SyncGoodsReceiptLineRow` — goods_receipt, `SyncOpeningBalanceLineRow` — opening_balance, `SyncWriteOffLineRow`
 * — write_off, `SyncInventoryLineRow` — inventory, `SyncSupplierReturnLineRow` — supplier_return,
 * `SyncProductMergeLineRow` — product_merge), the batches it created, its movements and the retail prices it set.
 */
export interface DocumentPostedPayload {
  document: SyncStockDocumentRow;
  lines:
    | SyncGoodsReceiptLineRow[]
    | SyncOpeningBalanceLineRow[]
    | SyncWriteOffLineRow[]
    | SyncInventoryLineRow[]
    | SyncSupplierReturnLineRow[]
    | SyncProductMergeLineRow[];
  batches: SyncBatchRow[];
  movements: SyncMovementRow[];
  prices: SyncLocalPrice[];
  audit: SyncAuditRow[];
}

/* ---------------- payloads of PR 2d: transfers ---------------- */

/** A transfer the store dispatched (spec E34): the header of `documents` (type `transfer`, status `in_transit`). */
export interface SyncTransferRow {
  id: string;
  /** The sender — the store of the key. */
  storeId: string;
  destinationStoreId: string;
  number: string;
  /** The day of the dispatch at the store. */
  documentDate: string;
  comment: string | null;
  createdBy: string;
  dispatchedAt: string;
  dispatchedBy: string;
  requestDocumentId: string | null;
}

export interface SyncTransferLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  productId: string;
  sourceBatchId: string;
  qtySentPieces: number;
  unit: 'pack' | 'piece';
}

export interface TransferDispatchedPayload {
  transfer: SyncTransferRow;
  lines: SyncTransferLineRow[];
  movements: SyncMovementRow[];
  audit: SyncAuditRow[];
}

/**
 * A transfer the store accepted (spec E34): every line of the transfer once with the pieces received, the batches of
 * the receiver (the values of the sender's batch), their movements and the sender's price copied as a local price
 * of the receiver (E18).
 */
export interface TransferAcceptedPayload {
  transferId: string;
  receivedAt: string;
  receivedBy: string;
  /** The day of the acceptance at the store: the date of the movements. */
  receivedDate: string;
  comment: string | null;
  lines: Array<{
    lineId: string;
    qtyReceivedPieces: number;
    targetBatchId: string | null;
  }>;
  batches: SyncBatchRow[];
  movements: SyncMovementRow[];
  prices: SyncLocalPrice[];
  audit: SyncAuditRow[];
}

/* ---------------- the change feed, cloud → store (PR 3) ---------------- */

/** An entity of the feed (spec 5.1); the scope is the network unless the entity is of one store. */
export type SyncEntityType =
  | 'product'
  | 'category'
  | 'store_price'
  | 'discount_rule'
  | 'role'
  | 'employee'
  | 'supplier'
  | 'tenant_settings'
  | 'return_policy'
  | 'legal_entity'
  | 'store'
  | 'transfer_in_transit'
  | 'transfer_result'
  | 'purchase_order'
  | 'transfer_request'
  | 'price_conflict'
  | 'duplicate_conflict';

/**
 * The state of an entity when the feed was read: the rows of its tables by the table name in camelCase (e.g.
 * `products`, `productBarcodes`), columns in camelCase as the cloud stores them — the store upserts them by id
 * (spec E27). Money in integer dirams, times in ISO 8601.
 */
export type SyncEntityData = Record<string, Array<Record<string, unknown>>>;

/** One entry of the feed: an entity changed; `delete` — it is gone, the store archives it. */
export interface SyncChange {
  seq: number;
  entityType: SyncEntityType;
  /** The version of the entity's format (spec E7: 1 now; a store of an older version gets it downcast later). */
  typeVersion: number;
  entityId: string;
  scopeStoreId: string | null;
  op: 'upsert' | 'delete';
  data: SyncEntityData | null;
}

/**
 * GET /api/v1/sync/changes?cursor&limit — the changes after `cursor`, one entry per entity with its current state,
 * in the order of their last change. `cursor` of the answer is where the next page starts.
 */
export interface SyncChangesResponse {
  changes: SyncChange[];
  cursor: number;
  hasMore: boolean;
}
