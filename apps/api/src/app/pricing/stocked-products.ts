import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';

/** Keys `${storeId}/${productId}` of the products with positive stock at the stores. */
export type StockedProductSource = (
  trx: TenantTransaction,
  tenantId: string,
  storeIds: readonly string[],
  productIds: readonly string[] | undefined,
) => Promise<Set<string>>;

// The products in stock at the stores, filled by the inventory module (spec 2026-10-15-nav-counters,
// E6): the price problem «no price» needs the stock without pricing depending on inventory, which
// already depends on pricing (StorePriceWriter). Nothing registered — nothing in stock.
@Injectable()
export class StockedProducts {
  private source: StockedProductSource | null = null;

  register(source: StockedProductSource): void {
    this.source = source;
  }

  /** Of every product, or only of `productIds`. */
  stockedAt(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    productIds?: readonly string[],
  ): Promise<Set<string>> {
    return this.source &&
      storeIds.length > 0 &&
      (productIds === undefined || productIds.length > 0)
      ? this.source(trx, tenantId, storeIds, productIds)
      : Promise.resolve(new Set());
  }
}
