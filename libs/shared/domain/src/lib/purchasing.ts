/*
 * Purchasing rules (ТЗ «Закупки», UI mockups «Заказы поставщикам», «Поставщики и долги»): the order
 * proposed by the deficit, the order status after receipts, the supplier debt by due dates.
 * Quantities of orders are whole packs; amounts are integer dirams, TJS only (ADR-0016).
 */

export interface DeficitInput {
  /** Stock of the store, pieces (may be negative after merging an offline store, ADR-0014). */
  stockPieces: number;
  piecesPerPack: number;
  /** Minimum stock of the product, packs. */
  minPacks: number;
  /** Consumption of the last 30 days, packs. */
  sales30Packs: number;
}

/**
 * Packs to order for a product below its minimum: enough to cover the next 30 days of consumption
 * and stay at the minimum («заполнить по дефициту»). Zero when the stock is at or above the minimum.
 */
export function deficitQuantity(input: DeficitInput): number {
  if (input.piecesPerPack < 1)
    throw new RangeError('piecesPerPack must be ≥ 1');
  const stockPacks = input.stockPieces / input.piecesPerPack;
  if (stockPacks >= input.minPacks) return 0;
  return Math.ceil(input.minPacks + input.sales30Packs - stockPacks);
}

export type PurchaseOrderStatus =
  'draft' | 'confirmed' | 'partially_received' | 'closed';

export interface OrderedLine {
  quantity: number;
  receivedQuantity: number;
}

/** Share of the ordered packs already received, whole percent (capped at 100). */
export function receivedPercent(lines: readonly OrderedLine[]): number {
  const ordered = lines.reduce((sum, l) => sum + l.quantity, 0);
  if (ordered === 0) return 0;
  const received = lines.reduce(
    (sum, l) => sum + Math.min(l.receivedQuantity, l.quantity),
    0,
  );
  return Math.floor((received * 100) / ordered);
}

/** Status of a confirmed order after its receipts: closed once every line is received in full. */
export function orderStatusAfterReceipt(
  lines: readonly OrderedLine[],
): Exclude<PurchaseOrderStatus, 'draft'> {
  if (lines.every((l) => l.receivedQuantity >= l.quantity)) return 'closed';
  return lines.some((l) => l.receivedQuantity > 0)
    ? 'partially_received'
    : 'confirmed';
}

export interface SupplierInvoice {
  /** Number of the posted goods receipt (or of the opening balance). */
  document: string;
  /** YYYY-MM-DD */
  dueOn: string;
  amountMinor: number;
}

export interface OpenInvoice extends SupplierInvoice {
  remainingMinor: number;
}

export interface SupplierDebt {
  debtMinor: number;
  /** Nearest due date of an unpaid invoice; null without debt. */
  nextDueOn: string | null;
  overdueMinor: number;
  /** Days since the oldest unpaid due date has passed; 0 when nothing is overdue. */
  overdueDays: number;
  open: OpenInvoice[];
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/**
 * Debt to a supplier by due dates: payments and supplier returns cover the invoices with the
 * earliest due date first (FIFO), what is left is the debt; an unpaid invoice past its due date is
 * overdue. Credits above the invoices are an advance and do not make the debt negative.
 */
export function supplierDebt(
  invoices: readonly SupplierInvoice[],
  creditsMinor: number,
  today: string,
): SupplierDebt {
  let credit = Math.max(0, creditsMinor);
  const open: OpenInvoice[] = [];
  for (const invoice of [...invoices].sort(
    (a, b) =>
      a.dueOn.localeCompare(b.dueOn) || a.document.localeCompare(b.document),
  )) {
    const covered = Math.min(credit, invoice.amountMinor);
    credit -= covered;
    if (invoice.amountMinor > covered) {
      open.push({ ...invoice, remainingMinor: invoice.amountMinor - covered });
    }
  }
  const overdue = open.filter((i) => i.dueOn < today);
  return {
    debtMinor: open.reduce((sum, i) => sum + i.remainingMinor, 0),
    nextDueOn: open[0]?.dueOn ?? null,
    overdueMinor: overdue.reduce((sum, i) => sum + i.remainingMinor, 0),
    overdueDays: overdue[0]
      ? dayNumber(today) - dayNumber(overdue[0].dueOn)
      : 0,
    open,
  };
}
