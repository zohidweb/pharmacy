/*
 * REST contract of the POS (ТЗ «Касса», ADR-0015): catalog snapshot of the store for scan and
 * search, sale (receipt), held receipts, shift and its cash operations, customer returns.
 * Amounts are integer dirams (ADR-0016). Buffered operations (sale, shift open / cash movement /
 * close) carry a client UUIDv7 `id` that is also the Idempotency-Key, plus terminal context
 * (ADR-0015, «Буфер кассы»): a repeat with the same key returns the original result, another
 * payload with the same key — 409.
 */
import type { DiscountRule } from '@pharmacy/shared-domain';
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

/** ПКУ: prescription and buyer document, recorded in the ПКУ journal (ТЗ). */
export interface ControlledSaleData {
  prescriptionNumber: string;
  /** YYYY-MM-DD */
  prescriptionDate: string;
  clinic: string;
  doctor: string;
  buyerName: string;
  buyerDocument: string;
}

export interface ReceiptLineInput {
  productId: string;
  batchId: string;
  unit: SaleUnit;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  controlled: ControlledSaleData | null;
}

/** Card, QR and NFC go through the bank's own terminal by hand — no integration (CLAUDE.md). */
export type ReceiptPaymentMethod = 'cash' | 'card' | 'qr' | 'nfc';

export interface ReceiptPayment {
  method: ReceiptPaymentMethod;
  amountMinor: number;
}

/** Context of every buffered POS operation (ADR-0015). */
export interface PosOperationContext {
  /** UUIDv7; also the Idempotency-Key. */
  id: string;
  storeId: string;
  terminalId: string | null;
  employeeId: string;
  /** ISO instant by the PC clock; the server stores its own receivedAt too. */
  occurredAt: string;
}

/** POST /api/v1/receipts — a paid sale. */
export interface CreateReceiptRequest extends PosOperationContext {
  shiftId: string;
  /** Snapshot version the prices come from: the server accepts them («продажа — факт»). */
  priceListVersion: number;
  lines: ReceiptLineInput[];
  subtotalMinor: number;
  discountRuleId: string | null;
  discountMinor: number;
  totalMinor: number;
  payments: ReceiptPayment[];
  /** Cash handed over by the customer; change = tendered − cash part. */
  cashTenderedMinor: number;
  changeMinor: number;
}

export interface CreatedReceipt {
  id: string;
  number: string;
  /** Fiscal requisites of the ККМ; null until the fiscal adapter is chosen (stack.md, вопрос 9). */
  fiscal: null;
  /** Prices or stock that differed from the server at acceptance — marked for the manager. */
  discrepancies: number;
}

/** GET /api/v1/stores/{storeId}/held-receipts — visible to every cashier of the store. */
export interface HeldReceipt {
  id: string;
  lines: Array<Omit<ReceiptLineInput, 'controlled'> & { productName: string }>;
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
}

/** GET /api/v1/shifts/current — the open shift of the terminal (or of the store without one). */
export interface Shift {
  id: string;
  number: number;
  storeId: string;
  status: ShiftStatus;
  openedAt: string;
  openedBy: string;
  closedAt: string | null;
  receipts: number;
  byMethod: Record<ReceiptPaymentMethod, PaymentTotal>;
  returns: PaymentTotal;
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
  events: ShiftEvent[];
}

/** POST /api/v1/shifts — open; 409 `shift_open` if the terminal already has one. */
export interface OpenShiftRequest extends PosOperationContext {
  openingCashMinor: number;
}

/** POST /api/v1/shifts/{id}/cash-movements */
export interface CashMovementRequest extends PosOperationContext {
  shiftId: string;
  kind: CashMovementKind;
  amountMinor: number;
  reason: CashInReason | CashOutReason;
  comment: string;
}

/** POST /api/v1/shifts/{id}/closure — reconciliation; card/QR/NFC are checked by hand with the bank terminal. */
export interface CloseShiftRequest extends PosOperationContext {
  shiftId: string;
  actualCashMinor: number;
  discrepancyReason: string;
  terminalTotals: Record<Exclude<ReceiptPaymentMethod, 'cash'>, number>;
}

/** Z-report of a closed shift. */
export interface ZReport {
  shift: Shift;
  actualCashMinor: number;
  discrepancyMinor: number;
  terminalDiff: Record<Exclude<ReceiptPaymentMethod, 'cash'>, number>;
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
}

/**
 * GET /api/v1/receipts/returnable?number= (or ?qr=) — a receipt of the store for a return.
 * 404 `not_found`; 422 `return_window_expired` past the return window of the network.
 */
export interface ReturnableReceipt {
  id: string;
  number: string;
  soldAt: string;
  storeName: string;
  cashierName: string;
  /** Days left in the return window. */
  daysLeft: number;
  subtotalMinor: number;
  discountMinor: number;
  discountPercent: number;
  /** Threshold of the applied rule; 0 without discount. */
  discountMinSubtotalMinor: number;
  /** Subtotal returned by earlier returns. */
  returnedSubtotalMinor: number;
  payments: ReceiptPayment[];
  lines: ReturnableLine[];
}

/** GET /api/v1/returns/sales-search?query=&date= — sales of a product without a receipt (`returns:without-receipt`). */
export interface SaleSearchItem {
  receiptId: string;
  receiptNumber: string;
  soldAt: string;
  productName: string;
  quantity: number;
  unit: SaleUnit;
  amountMinor: number;
}

export interface ReturnLineInput {
  lineId: string;
  quantity: number;
}

/** POST /api/v1/returns — money goes back the same way it was paid, goods into the same batch (ТЗ). */
export interface CreateReturnRequest extends PosOperationContext {
  receiptId: string;
  shiftId: string;
  lines: ReturnLineInput[];
  reason: ReturnReason;
  refunds: ReceiptPayment[];
  refundMinor: number;
}

export interface CreatedReturn {
  id: string;
  number: string;
  refundMinor: number;
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
  method: ReceiptPaymentMethod;
  cashierName: string;
}

/** GET /api/v1/returns?storeId=&reason=&limit=&offset= — journal of returns (ВЗ). */
export type ReturnListResponse = Page<ReturnListItem>;

/** GET /api/v1/deployment — where this web build runs: the Service Worker is cloud-only. */
export interface DeploymentInfo {
  kind: 'cloud' | 'offline-store';
}
