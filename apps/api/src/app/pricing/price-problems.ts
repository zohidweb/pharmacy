import { Injectable } from '@nestjs/common';
import { priceWarnings } from '@pharmacy/shared-domain';
import type { TenantTransaction } from '../../core/database';
import { ProductsReader } from '../catalog/products-reader';
import { PricingRepository } from './pricing.repository';
import { PurchasePrices } from './purchase-prices';
import { StockedProducts } from './stocked-products';

// Price problems of the pharmacies (spec 2026-10-15-nav-counters, E5): the pairs active product ×
// pharmacy with a warning of the price list — above the regulated maximum, below the last purchase
// price (the network's warnBelowCost and finance:view-cost), or in stock without a price. One rule for
// the menu counter and the filter «Только с проблемами». Callers pass pharmacies only: a warehouse
// does not sell.
@Injectable()
export class PriceProblems {
  constructor(
    private readonly repository: PricingRepository,
    private readonly products: ProductsReader,
    private readonly stocked: StockedProducts,
    private readonly purchasePrices: PurchasePrices,
  ) {}

  async count(
    trx: TenantTransaction,
    tenantId: string,
    pharmacyIds: readonly string[],
    canSeeCost: boolean,
  ): Promise<number> {
    return (await this.pairs(trx, tenantId, pharmacyIds, canSeeCost)).length;
  }

  /** The products with a problem at any of the pharmacies. */
  async productIds(
    trx: TenantTransaction,
    tenantId: string,
    pharmacyIds: readonly string[],
    canSeeCost: boolean,
  ): Promise<string[]> {
    return [
      ...new Set(
        (await this.pairs(trx, tenantId, pharmacyIds, canSeeCost)).map(
          (pair) => pair.productId,
        ),
      ),
    ];
  }

  private async pairs(
    trx: TenantTransaction,
    tenantId: string,
    pharmacyIds: readonly string[],
    canSeeCost: boolean,
  ): Promise<Array<{ storeId: string; productId: string }>> {
    if (pharmacyIds.length === 0) return [];
    const price = new Map(
      (await this.repository.pricesOfStores(trx, tenantId, pharmacyIds)).map(
        (cell) => [
          `${cell.storeId}/${cell.productId}`,
          Number(cell.priceDirams),
        ],
      ),
    );
    const stocked = await this.stocked.stockedAt(trx, tenantId, pharmacyIds);
    const keys = new Set([...price.keys(), ...stocked]);
    const maxPrice = await this.products.activeMaxPrices(trx, tenantId, [
      ...new Set([...keys].map((key) => key.split('/')[1])),
    ]);
    const { warnBelowCost } = await this.repository.settings(trx, tenantId);
    const costs =
      canSeeCost && warnBelowCost
        ? await this.purchasePrices.lastPackCosts(trx, tenantId, [
            ...maxPrice.keys(),
          ])
        : new Map<string, number>();
    const pairs: Array<{ storeId: string; productId: string }> = [];
    for (const key of keys) {
      const [storeId, productId] = key.split('/');
      if (!maxPrice.has(productId)) continue;
      const warnings = priceWarnings({
        priceMinor: price.get(key) ?? null,
        costMinor: costs.get(productId) ?? null,
        maxPriceMinor: maxPrice.get(productId) ?? null,
        inStock: stocked.has(key),
      });
      if (warnings.length > 0) pairs.push({ storeId, productId });
    }
    return pairs;
  }
}
