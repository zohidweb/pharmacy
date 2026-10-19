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
  /** The feed cursor of the store; null before the first pull. */
  feedCursor: string | null;
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
   * pack) — the supplier invoice; null for a write-off (the cloud computes pieces × the cost of a piece).
   */
  totalDirams: number | null;
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

/** A retail price a posting set at the store (spec E18): applied by the rule of `price.changed-locally`. */
export type SyncLocalPrice = Omit<PriceChangedLocallyPayload, 'audit'>;

/**
 * A stock document the store posted (spec 4.2): its header, the rows of the line table of `document.type`
 * (`SyncGoodsReceiptLineRow` — goods_receipt, `SyncOpeningBalanceLineRow` — opening_balance, `SyncWriteOffLineRow`
 * — write_off), the batches it created, its movements and the retail prices it set.
 */
export interface DocumentPostedPayload {
  document: SyncStockDocumentRow;
  lines:
    | SyncGoodsReceiptLineRow[]
    | SyncOpeningBalanceLineRow[]
    | SyncWriteOffLineRow[];
  batches: SyncBatchRow[];
  movements: SyncMovementRow[];
  prices: SyncLocalPrice[];
  audit: SyncAuditRow[];
}
