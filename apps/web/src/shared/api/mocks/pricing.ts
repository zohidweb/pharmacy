/*
 * Prices the mocks share between the POS, the stock and the catalog screens: the price of a store
 * over the network price, and the discount rules that apply at a store today.
 */
import { discountRuleStatus, type DiscountRule } from '@pharmacy/shared-domain';
import type { PosProduct } from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { mockDb } from './db';

/** Price of a pack at a store: its own price, else the network price of the product. */
export function storePrice(storeId: string, product: PosProduct): number {
  return (
    mockDb().catalog.storePrices[storeId]?.[product.id] ?? product.priceMinor
  );
}

export function setStorePrice(
  storeId: string,
  productId: string,
  priceMinor: number,
) {
  (mockDb().catalog.storePrices[storeId] ??= {})[productId] = priceMinor;
}

/** Price of one piece of a divisible pack at a store (rounded up, like the cost of a piece). */
export function piecePrice(product: PosProduct, packPriceMinor: number) {
  return product.divisible
    ? Math.ceil(packPriceMinor / product.piecesPerPack)
    : null;
}

/** Thresholds of the rules active at the store today; the POS applies the best one. */
export function activeDiscountThresholds(storeId: string): DiscountRule[] {
  const today = toAppDate();
  return mockDb()
    .catalog.discountRules.filter(
      (rule) => rule.storeIds === null || rule.storeIds.includes(storeId),
    )
    .filter((rule) => discountRuleStatus(rule.period, today) === 'active')
    .flatMap((rule) =>
      rule.thresholds.map((threshold, index) => ({
        id: `${rule.id}-${index}`,
        ...threshold,
      })),
    );
}

/**
 * A threshold by the id the POS sent — any status: an offline receipt may carry a rule that has
 * expired since («продажа — факт»).
 */
export function discountThresholdById(
  id: string | null,
): DiscountRule | undefined {
  if (!id) return undefined;
  for (const rule of mockDb().catalog.discountRules) {
    const index = rule.thresholds.findIndex(
      (_threshold, i) => `${rule.id}-${i}` === id,
    );
    if (index >= 0) return { id, ...rule.thresholds[index] };
  }
  return undefined;
}
