/*
 * Draft receipt of the POS as pure functions (ADR-0015: the receipt reducer is a pure function with
 * a coverage threshold): lines by batch with FEFO by default, sale by the piece, discount by
 * threshold, mixed payment and change. A wholesale draft (spec 2026-11-03-pos-store-ideas, D24–D25) sells packs at
 * the wholesale price of the store, without ПКУ and without the discounts of the network. Money is integer dirams;
 * nothing here touches the network.
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
  WholesaleBuyer,
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
  /**
   * Pieces in a pack in the snapshot the line was priced by (spec 2026-10-13-pos-shift-sale, E23);
   * absent in a draft stored before it.
   */
  piecesPerPack?: number;
  /**
   * Version of the snapshot the line was priced by: the server accepts the price of the store at that moment (ADR-0015,
   * amendment 2026-10-23); absent in a draft stored before it.
   */
  priceVersion?: number;
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
  /**
   * The buyer of a wholesale receipt (spec 2026-11-03-pos-store-ideas, D24); null — a retail receipt. Absent in a draft
   * stored before it.
   */
  wholesale?: WholesaleBuyer | null;
}

export type AddError =
  | 'out_of_stock'
  | 'not_divisible'
  | 'stock_exceeded'
  /** A wholesale draft: the store sells the product only retail. */
  | 'no_wholesale_price'
  | 'wholesale_controlled'
  | 'wholesale_piece';

export interface AddOptions {
  unit?: SaleUnit;
  today: string;
  /** A batch chosen by the cashier instead of FEFO. */
  batch?: PosBatch;
  controlled?: ControlledSaleData | null;
  quantity?: number;
  /** Version of the snapshot the product comes from: kept by a new line. */
  priceVersion?: number;
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

/** The price of a unit: retail, or the wholesale price of a pack (a snapshot stored before it has none). */
export function unitPrice(
  product: PosProduct,
  unit: SaleUnit,
  wholesale = false,
): number {
  if (wholesale) return product.wholesalePriceMinor ?? 0;
  return unit === 'pack' ? product.priceMinor : (product.piecePriceMinor ?? 0);
}

/** Why a product cannot go into a wholesale receipt (D25), or null. */
function wholesaleError(
  product: Pick<PosProduct, 'prescription' | 'wholesalePriceMinor'>,
  unit: SaleUnit,
): AddError | null {
  if (product.prescription === 'controlled') return 'wholesale_controlled';
  if (unit === 'piece') return 'wholesale_piece';
  if ((product.wholesalePriceMinor ?? null) === null) {
    return 'no_wholesale_price';
  }
  return null;
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
  priceVersion: number | undefined,
  wholesale: boolean,
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
    unitPriceMinor: unitPrice(product, unit, wholesale),
    prescription: product.prescription,
    controlled,
    manualBatch,
    piecesPerPack: product.piecesPerPack,
    priceVersion,
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
  const wholesale = Boolean(draft.wholesale);
  if (wholesale) {
    const error = wholesaleError(product, unit);
    if (error) return { draft, error };
  }
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
              // the line keeps its price, so the version it was priced by
              priceVersion: line.priceVersion ?? options.priceVersion,
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
          options.priceVersion,
          wholesale,
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
  priceVersion?: number,
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
    priceVersion,
  });
  return result.error ? { draft, error: result.error } : result;
}

/**
 * The draft becomes a wholesale receipt of `buyer` (plan 2026-11-03-pos-store-ideas-pr3, R11): every line is priced by
 * the wholesale price of the snapshot `products`, or the first line that cannot be sold wholesale is the error and the
 * draft stays as it was. The payment starts over.
 */
export function toWholesale(
  draft: ReceiptDraft,
  buyer: WholesaleBuyer,
  products: ReadonlyMap<string, PosProduct>,
  priceVersion: number,
): {
  draft: ReceiptDraft;
  error: { code: AddError; productId: string } | null;
} {
  const lines: DraftLine[] = [];
  for (const line of draft.lines) {
    const product = products.get(line.productId);
    const code = product
      ? wholesaleError(product, line.unit)
      : 'no_wholesale_price';
    if (code || !product) {
      return {
        draft,
        error: {
          code: code ?? 'no_wholesale_price',
          productId: line.productId,
        },
      };
    }
    lines.push({
      ...line,
      unitPriceMinor: unitPrice(product, line.unit, true),
      priceVersion,
    });
  }
  return {
    draft: {
      ...draft,
      lines,
      wholesale: buyer,
      nonCash: { card: 0, qr: 0, nfc: 0 },
      cashTenderedMinor: null,
    },
    error: null,
  };
}

/** The buyer of a wholesale draft changes; the lines and the payment stay. */
export function setWholesaleBuyer(
  draft: ReceiptDraft,
  buyer: WholesaleBuyer,
): ReceiptDraft {
  return { ...draft, wholesale: buyer };
}

/**
 * Back to a retail receipt (R11): the lines are priced by the retail price of the snapshot (a product no longer in it
 * keeps its price), the payment starts over.
 */
export function toRetail(
  draft: ReceiptDraft,
  products: ReadonlyMap<string, PosProduct>,
  priceVersion: number,
): ReceiptDraft {
  return {
    ...draft,
    lines: draft.lines.map((line) => {
      const product = products.get(line.productId);
      return product
        ? {
            ...line,
            unitPriceMinor: unitPrice(product, line.unit),
            priceVersion,
          }
        : line;
    }),
    wholesale: null,
    nonCash: { card: 0, qr: 0, nfc: 0 },
    cashTenderedMinor: null,
  };
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
  // the discounts of the network do not apply to a wholesale receipt (R12)
  const discount = bestDiscount(subtotalMinor, draft.wholesale ? [] : rules);
  return {
    subtotalMinor,
    discount,
    totalMinor: subtotalMinor - discount.amountMinor,
  };
}

export type PaymentProblem = 'empty' | 'non_cash_exceeds_total' | 'cash_short';

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
  // the prescription data of a ПКУ line is optional (spec 2026-10-13-pos-shift-sale, K3)
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
