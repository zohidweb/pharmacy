import { Injectable } from '@nestjs/common';
import type { SyncLocalPrice } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  isMoney,
  openConflict,
  requireEmployees,
  requireProducts,
  resolveOpenConflict,
  sameStore,
  storeTime,
  SyncApplyError,
} from '../../core/sync';
import {
  PricingRepository,
  type StorePriceFact,
  type StorePriceRow,
} from './pricing.repository';

const isPrice = (value: unknown): value is number =>
  isMoney(value) && value > 0;

// The rule of a price an offline store set for itself (ADR-0014 §4; spec 2026-10-16-offline-sync, E18, E25, E38,
// section 13), shared by `price.changed-locally` and the retail prices of the store's postings: the store's price
// becomes the cloud price of that store when the cloud has no price, the cloud price is still the version the
// store last received, or the last write of the row was this store's own; otherwise the cloud price stays and one
// open price conflict is opened or refreshed for the owner. Runs in the caller's transaction.
@Injectable()
export class LocalPriceRule {
  constructor(private readonly repository: PricingRepository) {}

  async apply(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    price: SyncLocalPrice,
  ): Promise<'applied' | 'conflict'> {
    sameStore(price.storeId, storeId);
    if (
      !isPrice(price.retailPricePerPackDirams) ||
      (price.retailPricePerPieceDirams !== null &&
        !isPrice(price.retailPricePerPieceDirams))
    ) {
      throw new SyncApplyError('invalid_price');
    }
    const base = price.basePriceVersion;
    if (base !== null && !(Number.isSafeInteger(base) && base >= 1)) {
      throw new SyncApplyError('invalid_price_version');
    }
    const fact: StorePriceFact = {
      tenantId,
      storeId,
      productId: price.productId,
      priceDirams: price.retailPricePerPackDirams,
      piecePriceDirams: price.retailPricePerPieceDirams,
      changedBy: price.changedBy,
      changedAt: storeTime(price.changedAt),
    };
    await requireProducts(trx, tenantId, [fact.productId]);
    await requireEmployees(trx, tenantId, [fact.changedBy]);

    let current = await this.repository.lockStorePrice(
      trx,
      tenantId,
      storeId,
      fact.productId,
    );
    if (current === null) {
      if (await this.repository.insertStorePriceFromStore(trx, fact)) {
        await this.closeConflict(trx, fact);
        return 'applied';
      }
      // a writer of the cloud inserted the row meanwhile: compare with it
      current = await this.repository.lockStorePrice(
        trx,
        tenantId,
        storeId,
        fact.productId,
      );
      if (current === null) throw new Error('The store price row vanished');
    }

    // `price_source = store`: the last write of this row was this store's own change and no writer of the cloud
    // came after it, so the store's next edit replaces it whatever version the store last received.
    if (
      current.priceDirams === null ||
      current.priceVersion === base ||
      current.priceSource === 'store'
    ) {
      await this.repository.updateStorePriceFromStore(trx, fact);
      await this.closeConflict(trx, fact);
      return 'applied';
    }
    await openConflict(
      trx,
      {
        tenantId,
        storeId,
        kind: 'price',
        entityId: fact.productId,
        localValue: {
          priceDirams: fact.priceDirams,
          piecePriceDirams: fact.piecePriceDirams,
          basePriceVersion: base,
          changedBy: fact.changedBy,
          changedAt: fact.changedAt.toISOString(),
        },
        cloudValue: cloudValue(current),
      },
      'refresh',
    );
    return 'conflict';
  }

  // A store change made after it saw the current cloud price is a new decision of the store (E38): an open
  // conflict about the same price is closed in its favour.
  private closeConflict(
    trx: TenantTransaction,
    fact: StorePriceFact,
  ): Promise<void> {
    return resolveOpenConflict(trx, {
      tenantId: fact.tenantId,
      storeId: fact.storeId,
      kind: 'price',
      entityId: fact.productId,
      resolution: 'local',
      resolvedBy: fact.changedBy,
      resolvedAt: new Date(),
    });
  }
}

function cloudValue(row: StorePriceRow): Record<string, unknown> {
  return {
    priceDirams: row.priceDirams === null ? null : Number(row.priceDirams),
    piecePriceDirams:
      row.piecePriceDirams === null ? null : Number(row.piecePriceDirams),
    priceVersion: row.priceVersion,
    changedBy: row.priceChangedBy,
    changedAt: row.priceChangedAt?.toISOString() ?? null,
  };
}
