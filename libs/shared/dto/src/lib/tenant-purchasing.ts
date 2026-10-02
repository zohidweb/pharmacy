/*
 * REST contract of purchasing (ТЗ «Закупки», UI mockups «Заказы поставщикам», «Поставщики и долги»).
 * Amounts are integer dirams, TJS only (ADR-0016): no currencies, exchange rates or exchange
 * differences. Purchase prices and debts are sent only with `finance:view-cost` (ADR-0018, п. 6).
 * Orders are not sent to suppliers by the system: there is no such channel in the closed list of
 * integrations (CLAUDE.md «Integrations»), the manager sends the printed order himself.
 */
import type { PurchaseOrderStatus } from '@pharmacy/shared-domain';
import type { Page } from './platform-tenants.js';
import type { DocumentAuthor } from './tenant-inventory.js';

export type { PurchaseOrderStatus };

export interface PurchaseOrderLine {
  productId: string;
  productName: string;
  /** Packs. */
  quantity: number;
  receivedQuantity: number;
  /** Price of a pack in the order. */
  priceMinor: number;
}

export interface PurchaseOrder {
  id: string;
  /** ЗК-000088: through numbering of the tenant. */
  number: string;
  status: PurchaseOrderStatus;
  /** YYYY-MM-DD */
  date: string;
  supplierId: string;
  supplierName: string;
  /** Store that receives the goods. */
  storeId: string;
  storeName: string;
  /** YYYY-MM-DD; null — not agreed. */
  expectedOn: string | null;
  comment: string;
  lines: PurchaseOrderLine[];
  totalMinor: number;
  receivedPercent: number;
  createdBy: DocumentAuthor;
  confirmedBy: DocumentAuthor | null;
}

/** POST /api/v1/purchase-orders, PUT /api/v1/purchase-orders/{id} — only a draft is edited. */
export interface PurchaseOrderInput {
  supplierId: string;
  storeId: string;
  expectedOn: string | null;
  comment: string;
  lines: Array<
    Pick<PurchaseOrderLine, 'productId' | 'quantity' | 'priceMinor'>
  >;
}

export interface PurchaseOrderListQuery {
  status?: PurchaseOrderStatus | 'open';
  supplierId?: string;
  storeId?: string;
  limit?: number;
  offset?: number;
}

export interface PurchaseOrderListItem {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  date: string;
  supplierName: string;
  storeName: string;
  positions: number;
  /** Only with `finance:view-cost`. */
  totalMinor?: number;
  receivedPercent: number;
}

/** GET /api/v1/purchase-orders?status=&supplierId=&storeId=&limit=&offset= */
export interface PurchaseOrderListResponse extends Page<PurchaseOrderListItem> {
  kpi: {
    open: number;
    draft: number;
    confirmed: number;
    partiallyReceived: number;
  };
}

/** GET /api/v1/purchase-orders/deficit?storeId=&supplierId= — lines of «заполнить по дефициту». */
export interface DeficitLine {
  productId: string;
  productName: string;
  stockPacks: number;
  minPacks: number;
  sales30Packs: number;
  /** Packs proposed by the deficit rule (shared-domain `deficitQuantity`). */
  quantity: number;
  /** Last purchase price of a pack from this supplier, else any; 0 — never bought. */
  priceMinor: number;
}

/* ---------------- suppliers ---------------- */

export type SupplierDebtState = 'none' | 'on_time' | 'overdue';

export interface Supplier {
  id: string;
  name: string;
  /** ИНН. */
  taxId: string;
  phone: string;
  address: string;
  /** Default payment delay of a goods receipt, days. */
  paymentDelayDays: number;
}

export type SupplierInput = Omit<Supplier, 'id'>;

export interface SupplierListItem extends Supplier {
  debtState: SupplierDebtState;
  /** Debt fields — only with `finance:view-cost`. */
  debtMinor?: number;
  overdueMinor?: number;
  /** Nearest due date of an unpaid receipt. */
  nextDueOn: string | null;
  overdueDays: number;
}

/** GET /api/v1/suppliers?limit=&offset= */
export interface SupplierListResponse extends Page<SupplierListItem> {
  /** Only with `finance:view-cost`. */
  totals?: { debtMinor: number; overdueMinor: number };
}

export type SupplierLedgerKind = 'opening' | 'receipt' | 'return' | 'payment';

export interface SupplierLedgerEntry {
  /** YYYY-MM-DD */
  date: string;
  kind: SupplierLedgerKind;
  /** Number of the document; empty for a payment without one. */
  document: string;
  comment: string;
  /** Only for a payment. */
  method?: SupplierPaymentMethod;
  /** Positive increases the debt, negative reduces it. */
  amountMinor: number;
  /** Debt after the entry. */
  balanceMinor: number;
}

export interface SupplierDocumentRow {
  id: string;
  number: string;
  date: string;
  storeName: string;
  totalMinor: number;
}

/** GET /api/v1/suppliers/{id} — the card with its history; requires `finance:view-cost`. */
export interface SupplierCard extends SupplierListItem {
  orders: Array<SupplierDocumentRow & { status: PurchaseOrderStatus }>;
  receipts: SupplierDocumentRow[];
  ledger: SupplierLedgerEntry[];
}

export type SupplierPaymentMethod = 'cash' | 'bank';

/**
 * POST /api/v1/suppliers/{id}/payments — a financial operation: `id` (UUIDv7) is the idempotency
 * key, a repeat with the same id returns the same payment (CLAUDE.md «Integrations»).
 */
export interface SupplierPaymentRequest {
  id: string;
  amountMinor: number;
  /** YYYY-MM-DD */
  date: string;
  method: SupplierPaymentMethod;
  comment: string;
}
