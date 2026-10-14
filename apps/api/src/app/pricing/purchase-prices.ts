import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';

/** The purchase price of a pack of each product, dirams; a product without one is absent. */
export type PurchasePriceSource = (
  trx: TenantTransaction,
  tenantId: string,
  productIds: readonly string[],
) => Promise<Map<string, number>>;

// The last purchase price of a pack, filled by the inventory module (spec 2026-10-14-owner-cabinet,
// E15): the price list compares a retail price with it without pricing depending on inventory,
// which already depends on pricing (StorePriceWriter). Nothing registered — no purchase prices.
@Injectable()
export class PurchasePrices {
  private source: PurchasePriceSource | null = null;

  register(source: PurchasePriceSource): void {
    this.source = source;
  }

  lastPackCosts(
    trx: TenantTransaction,
    tenantId: string,
    productIds: readonly string[],
  ): Promise<Map<string, number>> {
    return this.source && productIds.length > 0
      ? this.source(trx, tenantId, productIds)
      : Promise.resolve(new Map());
  }
}
