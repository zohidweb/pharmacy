/*
 * Prices of stock documents (ТЗ «Приход», CLAUDE.md «Conventions»): integer dirams; the cost of a
 * piece of a divided pack is rounded UP — in favour of the pharmacy; the retail price is proposed
 * by the markup as a draft the manager may change before posting.
 */

/** Cost of one piece of a pack, rounded up to a diram. */
export function pieceCost(
  packCostMinor: number,
  piecesPerPack: number,
): number {
  if (piecesPerPack < 1) throw new RangeError('piecesPerPack must be ≥ 1');
  return Math.ceil(packCostMinor / piecesPerPack);
}

/** Retail price proposed by the markup (whole percent), rounded up to a diram. */
export function suggestRetail(
  costMinor: number,
  markupPercent: number,
): number {
  return Math.ceil((costMinor * (100 + markupPercent)) / 100);
}

/** Markup of a retail price over the cost, whole percent (for the «+48 %» hint). */
export function markupOf(
  costMinor: number,
  retailMinor: number,
): number | null {
  if (costMinor <= 0) return null;
  return Math.round(((retailMinor - costMinor) * 100) / costMinor);
}

/** Difference of the actual purchase price from the ordered one, whole percent. */
export function priceDeviation(
  orderedMinor: number | null,
  actualMinor: number,
): number | null {
  if (orderedMinor === null || orderedMinor <= 0) return null;
  return Math.round(((actualMinor - orderedMinor) * 100) / orderedMinor);
}

export type StockState = 'ok' | 'low' | 'expiring' | 'out' | 'negative';

/** Days before expiry that make a batch «истекает». */
export const EXPIRY_WARNING_DAYS = 30;

/**
 * State of a stock row (UI mockup «Остатки»): negative — after merging an offline store
 * (ADR-0014, «продажа — факт»); out; expiring within the threshold; below the minimum; ok.
 */
export function stockState(input: {
  quantityPieces: number;
  minPieces: number;
  /** Days to expiry of the batch; null without a batch. */
  daysToExpiry: number | null;
}): StockState {
  if (input.quantityPieces < 0) return 'negative';
  if (input.quantityPieces === 0) return 'out';
  if (
    input.daysToExpiry !== null &&
    input.daysToExpiry <= EXPIRY_WARNING_DAYS
  ) {
    return 'expiring';
  }
  if (input.quantityPieces < input.minPieces) return 'low';
  return 'ok';
}

export type PriceWarning = 'above_max' | 'below_cost';

/**
 * Warnings of a retail price (UI mockup «Цены и скидки»): above the regulated maximum — a soft
 * warning the manager confirms (ТЗ: no ban); below the last purchase price of a pack.
 */
export function priceWarnings(input: {
  priceMinor: number;
  /** Last purchase price of a pack; undefined without `finance:view-cost`. */
  costMinor?: number | null;
  maxPriceMinor: number | null;
}): PriceWarning[] {
  const warnings: PriceWarning[] = [];
  if (input.maxPriceMinor !== null && input.priceMinor > input.maxPriceMinor) {
    warnings.push('above_max');
  }
  if (
    input.costMinor !== undefined &&
    input.costMinor !== null &&
    input.priceMinor < input.costMinor
  ) {
    warnings.push('below_cost');
  }
  return warnings;
}
