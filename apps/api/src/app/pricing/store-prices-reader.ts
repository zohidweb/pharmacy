import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { PricingRepository } from './pricing.repository';

/** The price of a product at a store: a pack, and the own piece price if set. */
export interface StorePrice {
  productId: string;
  packDirams: number;
  ownPieceDirams: number | null;
}

/** A step of a discount rule acting at a store: from the subtotal, whole percent. */
export interface ActiveTier {
  ruleId: string;
  minSubtotalDirams: number;
  percent: number;
}

// The public interface of the prices for the POS (ADR-0002; spec 2026-10-13-pos-shift-sale, 4.3 and
// 4.5): the snapshot and the acceptance of a receipt read the prices and the discount rules of a
// store only through it. Runs in the caller's transaction.
@Injectable()
export class StorePricesReader {
  constructor(private readonly repository: PricingRepository) {}

  /** Prices of the store that have a pack price: of the products, or every one (null). */
  async pricesOfStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    productIds: readonly string[] | null,
  ): Promise<Map<string, StorePrice>> {
    const rows = await this.repository.storePrices(
      trx,
      tenantId,
      storeId,
      productIds,
    );
    return new Map(
      rows.map((row) => [
        row.productId,
        {
          productId: row.productId,
          packDirams: Number(row.packDirams),
          ownPieceDirams:
            row.pieceDirams === null ? null : Number(row.pieceDirams),
        },
      ]),
    );
  }

  /** Products whose price at the store changed after a moment. */
  productsRepricedSince(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    since: Date,
  ): Promise<string[]> {
    return this.repository.repricedSince(trx, tenantId, storeId, since);
  }

  /** Steps of the discount rules acting at the store on a business date. */
  async activeTiers(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    businessDate: string,
  ): Promise<ActiveTier[]> {
    const rows = await this.repository.activeTiers(
      trx,
      tenantId,
      storeId,
      businessDate,
    );
    return rows.map((row) => ({
      ruleId: row.ruleId,
      minSubtotalDirams: Number(row.minTotalDirams),
      // the rules screen takes whole percent (DiscountThresholdDto), stored as basis points
      percent: Math.round(row.percentBp / 100),
    }));
  }

  /** A discount rule of the network exists, in any status. */
  ruleExists(
    trx: TenantTransaction,
    tenantId: string,
    ruleId: string,
  ): Promise<boolean> {
    return this.repository.ruleExists(trx, tenantId, ruleId);
  }
}
