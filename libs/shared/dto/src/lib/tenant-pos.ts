/*
 * REST contract of the POS (ТЗ «Касса», ADR-0015): catalog snapshot of the store for scan and
 * search, sale (receipt), held receipts, shift and its cash operations, customer returns.
 * Amounts are integer dirams (ADR-0016). Buffered operations (sale, shift open / cash movement /
 * close) carry a client UUIDv7 `id` that is also the Idempotency-Key, plus terminal context
 * (ADR-0015, «Буфер кассы»): a repeat with the same key returns the original result, another
 * payload with the same key — 409.
 */
import type { DiscountRule, PosBufferLimits } from '@pharmacy/shared-domain';
import type { Page } from './platform-tenants.js';

/** none — OTC; rx — prescription (warning); controlled — ПКУ (right + prescription data). */
export type PrescriptionKind = 'none' | 'rx' | 'controlled';

export type SaleUnit = 'pack' | 'piece';

export interface PosBatch {
  id: string;
  number: string;
  /** YYYY-MM-DD, date only. */
  expiresOn: string;
  /** Pieces left in the batch (packs × piecesPerPack + opened pieces). */
  quantityPieces: number;
  /** Purchase price of a pack; present only with `finance:view-cost` (ADR-0018, п. 6). */
  costMinor?: number;
}

export interface PosProduct {
  id: string;
  name: string;
  /** МНН — base of the analog search; null for non-drugs. */
  inn: string | null;
  manufacturer: string;
  country: string;
  form: string;
  categoryId: string;
  barcodes: string[];
  /** Pieces in a pack (≥ 1); a pack with more than one piece may be divisible. */
  piecesPerPack: number;
  /** Sale by the piece allowed (ТЗ: поштучная продажа). */
  divisible: boolean;
  prescription: PrescriptionKind;
  /** Store price of a pack. */
  priceMinor: number;
  /** Store price of one piece of a divisible pack. */
  piecePriceMinor: number | null;
  /** Batches of the store, any order; the POS applies FEFO. */
  batches: PosBatch[];
}

export interface PosCategory {
  id: string;
  name: string;
}

export interface PosStoreSettings {
  networkName: string;
  storeName: string;
  storeAddress: string;
  /** Taxpayer number printed on the receipt. */
  taxId: string;
  receiptFooter: string;
  /** Customer return window of the network, days. */
  returnWindowDays: number;
  /** Limits of the outage buffer of the network (spec 2026-10-21-pos-offline-limits, P6). */
  bufferLimits: PosBufferLimits;
}

/**
 * GET /api/v1/stores/{storeId}/catalog-snapshot?sinceVersion= — full snapshot or the changes since
 * a version (ADR-0015: local snapshot of catalog and prices in IndexedDB).
 */
export interface CatalogSnapshot {
  version: number;
  /** True — `products` is the whole catalog; false — only changed products. */
  full: boolean;
  products: PosProduct[];
  removedProductIds: string[];
  categories: PosCategory[];
  discountRules: DiscountRule[];
  settings: PosStoreSettings;
}

/**
 * ПКУ: prescription and buyer document, recorded in the ПКУ journal (ТЗ). Every field is optional
 * until the customer fixes the set (ТЗ, section 14; spec 2026-10-13-pos-shift-sale, K3).
 */
export interface ControlledSaleData {
  prescriptionNumber?: string;
  /** YYYY-MM-DD */
  prescriptionDate?: string;
  clinic?: string;
  doctor?: string;
  buyerName?: string;
  buyerDocument?: string;
}

export interface ReceiptLineInput {
  productId: string;
  batchId: string;
  unit: SaleUnit;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  /**
   * Values of the snapshot the POS counted by (E23): the server counts the pieces by them and marks
   * a product changed since, never refuses the sale for it.
   */
  piecesPerPack: number;
  /** The cashier chose a batch other than FEFO (`pos:choose-batch`). */
  batchChosenManually: boolean;
  /** Not null ⇔ the product was ПКУ in the snapshot; `{}` — no prescription data. */
  controlled: ControlledSaleData | null;
}

/** Card, QR and NFC go through the bank's own terminal by hand — no integration (CLAUDE.md). */
export type ReceiptPaymentMethod = 'cash' | 'card' | 'qr' | 'nfc';

export interface ReceiptPayment {
  method: ReceiptPaymentMethod;
  amountMinor: number;
}

/**
 * Context of every buffered POS operation (ADR-0015). Without a session of its author the operation is sent under
 * the terminal (device-cookie): the author must have held the terminal at its moment, else 422
 * `author_session_missing` (spec 2026-10-21-pos-offline-limits, P9, P10).
 */
export interface PosOperationContext {
  /** UUIDv7; also the Idempotency-Key. */
  id: string;
  storeId: string;
  terminalId: string | null;
  employeeId: string;
  /** ISO instant by the PC clock; the server stores its own receivedAt too. */
  occurredAt: string;
}

/**
 * POST /api/v1/receipts — a paid sale, a fact (ADR-0015): stock, price, discount and catalog
 * differences are marked, not refused. 400 `validation_failed` (`unknown_product`, `unknown_batch`,
 * `wrong_store`, `batch_expired`, `unknown_discount`, `total_mismatch`, `mismatch`, `too_small`),
 * 403 `terminal_required`, 409 `idempotency_conflict` / `no_open_shift` / `shift_closed` /
 * `wrong_terminal` / `offline_store_read_only`, 422 `author_not_allowed`; sent under the terminal without the
 * author's session (spec 2026-10-21-pos-offline-limits, P9, P10) — 422 `author_session_missing`.
 */
export interface CreateReceiptRequest extends PosOperationContext {
  /**
   * The number of the receipt of the terminal within its shift, 1–999999 (P12); absent in operations buffered
   * before it existed.
   */
  localNumber?: number;
  shiftId: string;
  /** Snapshot version the prices come from: the server accepts them («продажа — факт»). */
  priceListVersion: number;
  lines: ReceiptLineInput[];
  subtotalMinor: number;
  /** `DiscountRule.id` of the snapshot: `<ruleId>:<minSubtotalMinor>`. */
  discountRuleId: string | null;
  /** Percent and threshold of that step in the snapshot (E23); 0 without a discount. */
  discountPercent: number;
  discountMinSubtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  payments: ReceiptPayment[];
  /** Cash handed over by the customer; change = tendered − cash part. */
  cashTenderedMinor: number;
  changeMinor: number;
  /** Language of the printed receipt. */
  language: 'ru' | 'tj';
}

export interface CreatedReceipt {
  id: string;
  number: string;
  /** Fiscal requisites of the ККМ; null until the fiscal adapter is chosen (stack.md, вопрос 9). */
  fiscal: null;
  /**
   * Marks of the differences found at acceptance (stock, price, discount, catalog, author, closed
   * period; spec 2026-10-13-pos-shift-sale, E5) — the receipt is accepted and marked for the manager.
   */
  discrepancies: number;
}

/** GET /api/v1/stores/{storeId}/held-receipts — visible to every cashier of the store. */
export interface HeldReceipt {
  id: string;
  lines: Array<
    Omit<ReceiptLineInput, 'controlled' | 'piecesPerPack' | 'batchChosenManually'> & {
      productName: string;
    }
  >;
  subtotalMinor: number;
  heldAt: string;
  heldBy: string;
}

/** POST /api/v1/held-receipts; deleted at shift close (ТЗ). */
export interface HoldReceiptRequest {
  id: string;
  storeId: string;
  lines: HeldReceipt['lines'];
  subtotalMinor: number;
}

export type ShiftStatus = 'open' | 'closed';

export interface PaymentTotal {
  count: number;
  amountMinor: number;
}

export type CashMovementKind = 'in' | 'out';
export type CashInReason = 'change_fund' | 'other';
export type CashOutReason = 'collection' | 'expense';

export type ShiftEventKind =
  'opened' | 'sale' | 'return' | 'cash_in' | 'cash_out' | 'closed';

export interface ShiftEvent {
  id: string;
  at: string;
  kind: ShiftEventKind;
  /** Receipt or return number, reason of a cash movement. */
  reference: string | null;
  employeeName: string;
  /** Signed: money out of the drawer is negative. */
  amountMinor: number;
  /** A receipt with discrepancy marks, or an operation whose author has no right now (K7). */
  flagged: boolean;
}

/**
 * GET /api/v1/shifts/current — the open shift of the terminal of the PIN session (one per terminal,
 * K5); 404 `no_open_shift`, 403 `terminal_required` without a terminal.
 */
export interface Shift {
  id: string;
  /** `СМ-<store code>-<year>-<6 digits>`, the Z-report number. */
  number: string;
  storeId: string;
  status: ShiftStatus;
  openedAt: string;
  openedBy: string;
  closedAt: string | null;
  receipts: number;
  byMethod: Record<ReceiptPaymentMethod, PaymentTotal>;
  returns: PaymentTotal;
  /**
   * Returns made in this shift by the way the money went back (spec 2026-10-13-customer-returns,
   * E13): the bank terminal of a kind is reconciled against `byMethod − returnsByMethod`.
   */
  returnsByMethod: Record<ReceiptPaymentMethod, PaymentTotal>;
  /** Sales minus returns. */
  revenueMinor: number;
  cash: {
    openingMinor: number;
    salesMinor: number;
    inMinor: number;
    outMinor: number;
    returnsMinor: number;
    /** opening + sales + in − out − returns. */
    expectedMinor: number;
  };
  /** Receipts of the shift with discrepancy marks (K4). */
  discrepancyReceipts: number;
  /**
   * The largest local number of the receipts of the shift (spec 2026-10-21-pos-offline-limits, P12): a terminal whose
   * browser data was cleared numbers on after it. Absent in the Z-reports saved before it.
   */
  lastLocalNumber?: number | null;
  events: ShiftEvent[];
}

/** POST /api/v1/shifts — open; 409 `shift_open` if the terminal already has one, `idempotency_conflict`. */
export interface OpenShiftRequest extends PosOperationContext {
  openingCashMinor: number;
}

/** POST /api/v1/shifts/{id}/cash-movements — 409 `no_open_shift` / `shift_closed` / `idempotency_conflict`. */
export interface CashMovementRequest extends PosOperationContext {
  shiftId: string;
  kind: CashMovementKind;
  amountMinor: number;
  reason: CashInReason | CashOutReason;
  comment: string;
}

/**
 * POST /api/v1/shifts/{id}/closure — reconciliation; card/QR/NFC are checked by hand with the bank
 * terminal. Accepted as a fact (E24); 409 `no_open_shift` / `shift_closed` / `idempotency_conflict`.
 */
export interface CloseShiftRequest extends PosOperationContext {
  shiftId: string;
  actualCashMinor: number;
  discrepancyReason: string;
  terminalTotals: Record<Exclude<ReceiptPaymentMethod, 'cash'>, number>;
}

/**
 * Z-report of a closed shift: the answer of POST /shifts/{id}/closure and of
 * GET /api/v1/shifts/{id}/z-report (the snapshot saved at the closing).
 */
export interface ZReport {
  shift: Shift;
  actualCashMinor: number;
  discrepancyMinor: number;
  terminalDiff: Record<Exclude<ReceiptPaymentMethod, 'cash'>, number>;
  /** A discrepancy without a reason: the closing is a fact and is accepted (E24). */
  discrepancyReasonMissing: boolean;
}

export type ReturnReason = 'customer' | 'defect';

export interface ReturnableLine {
  lineId: string;
  productId: string;
  productName: string;
  batchId: string;
  batchNumber: string;
  unit: SaleUnit;
  quantity: number;
  /** Already returned by earlier returns. */
  returnedQuantity: number;
  unitPriceMinor: number;
  /** Discount share of the whole line: a return takes back its part (`returnLineRefund`, R1). */
  discountShareMinor: number;
  /** Kind of the product: ПКУ when the line was sold as ПКУ (E8). */
  kind: PrescriptionKind;
  /** The return policy of the network takes this kind back at the customer's wish (R3). */
  customerReturnAllowed: boolean;
  /** The batch has expired: a returned piece is written off (E9). */
  batchExpired: boolean;
}

/**
 * GET /api/v1/receipts/returnable?number= (or ?id= — the QR of the receipt) — a receipt of the store
 * for a return (`returns:create`). With `&productId=` — a sale found without the receipt: only the
 * lines of that product (R8, `returns:without-receipt`). 404 `not_found`; 422
 * `return_window_expired` past the return window of the network. `number` may also be the code printed on a
 * receipt made without the connection — the last 8 hex digits of its id (spec 2026-10-21-pos-offline-limits,
 * P14): 409 `receipt_code_ambiguous` when it fits several receipts of the store.
 */
export interface ReturnableReceipt {
  id: string;
  number: string;
  /** The number of the receipt of the terminal within its shift (P12); null for older receipts. */
  localNumber: number | null;
  soldAt: string;
  storeName: string;
  cashierName: string;
  /** Days left in the return window. */
  daysLeft: number;
  subtotalMinor: number;
  discountMinor: number;
  /** What can still go back by each way of payment: paid (cash net of change) − refunded (E7). */
  payments: ReceiptPayment[];
  lines: ReturnableLine[];
}

/** GET /api/v1/returns/sales-search?query=&date= — sales of a product without a receipt (`returns:without-receipt`). */
export interface SaleSearchItem {
  receiptId: string;
  receiptNumber: string;
  soldAt: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: SaleUnit;
  amountMinor: number;
}

export interface ReturnLineInput {
  lineId: string;
  quantity: number;
}

/**
 * POST /api/v1/returns — online, `Idempotency-Key` = `id` (spec 2026-10-13-customer-returns): money
 * goes back the same way it was paid, goods into the batch of the line; a defect and an expired batch
 * are written off. 400 `validation_failed` (`unknown_line`, `duplicate`, `positive`,
 * `total_mismatch`, `refund_exceeds_paid`, `unknown_method`, `required`); 403 `forbidden`,
 * `store_not_in_scope`, `terminal_required`; 404 `not_found`; 409 `idempotency_conflict`,
 * `no_open_shift`, `shift_closed`, `wrong_terminal`, `return_exceeds_sold`; 422
 * `return_window_expired`, `return_not_allowed` (`other_product`), `period_closed`.
 */
export interface CreateReturnRequest extends PosOperationContext {
  receiptId: string;
  shiftId: string;
  lines: ReturnLineInput[];
  reason: ReturnReason;
  /** Empty exactly when `refundMinor` is 0 (a price 0, a 100 % discount): the sum is checked. */
  refunds: ReceiptPayment[];
  refundMinor: number;
  /** The product of the search when the sale was found without the receipt (R8), else null. */
  foundProductId: string | null;
}

export interface CreatedReturn {
  id: string;
  number: string;
  refundMinor: number;
  /** The write-off of a defect or an expired batch (E9), if any. */
  writeOffNumber: string | null;
}

export interface ReturnListItem {
  id: string;
  number: string;
  at: string;
  storeName: string;
  receiptNumber: string;
  summary: string;
  reason: ReturnReason;
  refundMinor: number;
  methods: ReceiptPaymentMethod[];
  cashierName: string;
  foundWithoutReceipt: boolean;
  /** The write-off of a defect or an expired batch of the return (E9), if any. */
  writeOffNumber: string | null;
}

/** GET /api/v1/returns?storeId=&reason=&limit=&offset= — journal of returns (ВЗ, `returns:view`). */
export type ReturnListResponse = Page<ReturnListItem>;

/**
 * GET / PUT /api/v1/settings/returns — the return window and the return policy of the network
 * (`settings:view` / `settings:update`; spec 2026-10-13-customer-returns, R3, E17): which kinds of
 * products are taken back at the customer's wish; a defect is taken back always.
 */
export interface ReturnPolicy {
  /** 0–365; 0 — only on the day of the sale. */
  returnWindowDays: number;
  customerReturns: Record<PrescriptionKind, boolean>;
}

/** GET /api/v1/deployment — where this web build runs: the Service Worker is cloud-only. */
export interface DeploymentInfo {
  kind: 'cloud' | 'offline-store';
}
