/*
 * Draft receipt of the POS as pure functions (ADR-0015: the receipt reducer is a pure function with
 * a coverage threshold): lines by batch with FEFO by default, sale by the piece, discount by
 * threshold, mixed payment and change. Money is integer dirams; nothing here touches the network.
 */
import {
  bestDiscount,
  type AppliedDiscount,
  type DiscountRule,
} from '@pharmacy/shared-domain';
import type {
  ControlledSaleData,
  PosBatch,
  PosProduct,
  PrescriptionKind,
  ReceiptPayment,
  ReceiptPaymentMethod,
  SaleUnit,
} from '@pharmacy/shared-dto';
import { fefoBatches } from '@/entities/catalog';

export interface DraftLine {
  key: string;
  productId: string;
  name: string;
  batchId: string;
  batchNumber: string;
  expiresOn: string;
  unit: SaleUnit;
  quantity: number;
  unitPriceMinor: number;
  prescription: PrescriptionKind;
  controlled: ControlledSaleData | null;
  /** The cashier chose the batch instead of FEFO (`pos:choose-batch`). */
  manualBatch: boolean;
}

export type NonCashMethod = Exclude<ReceiptPaymentMethod, 'cash'>;

export interface ReceiptDraft {
  lines: DraftLine[];
  /** Amounts paid through the bank terminal by hand; the rest is cash. */
  nonCash: Record<NonCashMethod, number>;
  /** Cash handed over by the customer; null — exactly the cash part. */
  cashTenderedMinor: number | null;
  /** Held receipt this draft was resumed from (deleted on the server when paid). */
  heldId: string | null;
}

export type AddError = 'out_of_stock' | 'not_divisible' | 'stock_exceeded';

export interface AddOptions {
  unit?: SaleUnit;
  today: string;
  /** A batch chosen by the cashier instead of FEFO. */
  batch?: PosBatch;
  controlled?: ControlledSaleData | null;
  quantity?: number;
}

export function emptyDraft(): ReceiptDraft {
  return {
    lines: [],
    nonCash: { card: 0, qr: 0, nfc: 0 },
    cashTenderedMinor: null,
    heldId: null,
  };
}

export const piecesOf = (
  product: PosProduct,
  unit: SaleUnit,
  quantity: number,
) => (unit === 'pack' ? quantity * product.piecesPerPack : quantity);

export function unitPrice(product: PosProduct, unit: SaleUnit): number {
  return unit === 'pack' ? product.priceMinor : (product.piecePriceMinor ?? 0);
}

export const lineAmount = (line: DraftLine) =>
  line.quantity * line.unitPriceMinor;

const lineKey = (productId: string, batchId: string, unit: SaleUnit) =>
  `${productId}:${batchId}:${unit}`;

/** Pieces of a batch already taken by the draft. */
function taken(
  draft: ReceiptDraft,
  product: PosProduct,
  batchId: string,
): number {
  return draft.lines
    .filter((line) => line.productId === product.id && line.batchId === batchId)
    .reduce(
      (sum, line) => sum + piecesOf(product, line.unit, line.quantity),
      0,
    );
}

function toLine(
  product: PosProduct,
  batch: PosBatch,
  unit: SaleUnit,
  quantity: number,
  manualBatch: boolean,
  controlled: ControlledSaleData | null,
): DraftLine {
  return {
    key: lineKey(product.id, batch.id, unit),
    productId: product.id,
    name: product.name,
    batchId: batch.id,
    batchNumber: batch.number,
    expiresOn: batch.expiresOn,
    unit,
    quantity,
    unitPriceMinor: unitPrice(product, unit),
    prescription: product.prescription,
    controlled,
    manualBatch,
  };
}

/**
 * Adds a product: into the FEFO batch with room left (or the chosen batch); when the batch runs out
 * the next FEFO batch gets its own line. Expired batches are never offered.
 */
export function addProduct(
  draft: ReceiptDraft,
  product: PosProduct,
  options: AddOptions,
): { draft: ReceiptDraft; error: AddError | null } {
  const unit = options.unit ?? 'pack';
  const quantity = options.quantity ?? 1;
  if (unit === 'piece' && (!product.divisible || !product.piecePriceMinor)) {
    return { draft, error: 'not_divisible' };
  }
  const candidates = options.batch
    ? [options.batch].filter((b) => b.expiresOn >= options.today)
    : fefoBatches(product, options.today);
  if (candidates.length === 0) return { draft, error: 'out_of_stock' };
  const need = piecesOf(product, unit, quantity);
  const batch = candidates.find(
    (b) => b.quantityPieces - taken(draft, product, b.id) >= need,
  );
  if (!batch) return { draft, error: 'stock_exceeded' };
  const key = lineKey(product.id, batch.id, unit);
  const existing = draft.lines.find((line) => line.key === key);
  const lines = existing
    ? draft.lines.map((line) =>
        line.key === key
          ? {
              ...line,
              quantity: line.quantity + quantity,
              controlled: options.controlled ?? line.controlled,
            }
          : line,
      )
    : [
        ...draft.lines,
        toLine(
          product,
          batch,
          unit,
          quantity,
          Boolean(options.batch),
          options.controlled ?? null,
        ),
      ];
  return { draft: { ...draft, lines }, error: null };
}

/** New quantity of a line, limited by the stock of its batch. */
export function setQuantity(
  draft: ReceiptDraft,
  key: string,
  quantity: number,
  product: PosProduct,
): { draft: ReceiptDraft; error: AddError | null } {
  const line = draft.lines.find((l) => l.key === key);
  if (!line) return { draft, error: null };
  if (quantity < 1) return { draft: removeLine(draft, key), error: null };
  const batch = product.batches.find((b) => b.id === line.batchId);
  const others =
    taken(draft, product, line.batchId) -
    piecesOf(product, line.unit, line.quantity);
  if (
    !batch ||
    others + piecesOf(product, line.unit, quantity) > batch.quantityPieces
  ) {
    return { draft, error: 'stock_exceeded' };
  }
  return {
    draft: {
      ...draft,
      lines: draft.lines.map((l) => (l.key === key ? { ...l, quantity } : l)),
    },
    error: null,
  };
}

export function removeLine(draft: ReceiptDraft, key: string): ReceiptDraft {
  return { ...draft, lines: draft.lines.filter((line) => line.key !== key) };
}

/** Moves a line to another batch chosen by the cashier. */
export function changeBatch(
  draft: ReceiptDraft,
  key: string,
  product: PosProduct,
  batch: PosBatch,
  today: string,
): { draft: ReceiptDraft; error: AddError | null } {
  const line = draft.lines.find((l) => l.key === key);
  if (!line) return { draft, error: null };
  const without = removeLine(draft, key);
  const result = addProduct(without, product, {
    unit: line.unit,
    quantity: line.quantity,
    batch,
    today,
    controlled: line.controlled,
  });
  return result.error ? { draft, error: result.error } : result;
}

export interface ReceiptTotals {
  subtotalMinor: number;
  discount: AppliedDiscount;
  totalMinor: number;
}

export function totals(
  draft: ReceiptDraft,
  rules: readonly DiscountRule[],
): ReceiptTotals {
  const subtotalMinor = draft.lines.reduce(
    (sum, line) => sum + lineAmount(line),
    0,
  );
  const discount = bestDiscount(subtotalMinor, rules);
  return {
    subtotalMinor,
    discount,
    totalMinor: subtotalMinor - discount.amountMinor,
  };
}

export type PaymentProblem =
  'empty' | 'non_cash_exceeds_total' | 'cash_short' | 'controlled_data_missing';

export interface PaymentState {
  nonCashMinor: number;
  cashPartMinor: number;
  tenderedMinor: number;
  changeMinor: number;
  payments: ReceiptPayment[];
  problem: PaymentProblem | null;
}

/** Splits the total into bank-terminal parts and cash; change comes only from cash. */
export function paymentState(
  draft: ReceiptDraft,
  totalMinor: number,
): PaymentState {
  const nonCashMinor =
    draft.nonCash.card + draft.nonCash.qr + draft.nonCash.nfc;
  const cashPartMinor = Math.max(0, totalMinor - nonCashMinor);
  const tenderedMinor = draft.cashTenderedMinor ?? cashPartMinor;
  const payments: ReceiptPayment[] = [
    ...(cashPartMinor > 0
      ? [{ method: 'cash' as const, amountMinor: cashPartMinor }]
      : []),
    ...(['card', 'qr', 'nfc'] as const)
      .filter((method) => draft.nonCash[method] > 0)
      .map((method) => ({ method, amountMinor: draft.nonCash[method] })),
  ];
  let problem: PaymentProblem | null = null;
  if (draft.lines.length === 0) problem = 'empty';
  else if (nonCashMinor > totalMinor) problem = 'non_cash_exceeds_total';
  else if (tenderedMinor < cashPartMinor) problem = 'cash_short';
  else if (
    draft.lines.some((l) => l.prescription === 'controlled' && !l.controlled)
  ) {
    problem = 'controlled_data_missing';
  }
  return {
    nonCashMinor,
    cashPartMinor,
    tenderedMinor,
    changeMinor: Math.max(0, tenderedMinor - cashPartMinor),
    payments,
    problem,
  };
}

export function setNonCash(
  draft: ReceiptDraft,
  method: NonCashMethod,
  amountMinor: number,
): ReceiptDraft {
  return {
    ...draft,
    nonCash: { ...draft.nonCash, [method]: Math.max(0, amountMinor) },
  };
}

export function setTendered(
  draft: ReceiptDraft,
  amountMinor: number | null,
): ReceiptDraft {
  return { ...draft, cashTenderedMinor: amountMinor };
}

/** The whole total through one bank-terminal method (one tap «Карта»). */
export function payAllBy(
  draft: ReceiptDraft,
  method: ReceiptPaymentMethod,
  totalMinor: number,
): ReceiptDraft {
  const nonCash = { card: 0, qr: 0, nfc: 0 };
  if (method !== 'cash') nonCash[method] = totalMinor;
  return { ...draft, nonCash, cashTenderedMinor: null };
}
