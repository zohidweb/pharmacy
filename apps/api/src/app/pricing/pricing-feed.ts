import { Injectable } from '@nestjs/common';
import type { SyncEntityData, SyncEntityType } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import { type FeedSource, feedRow, SyncFeedSources } from '../../core/sync';

// The columns are named (version 1, spec E7): a column added to a table never reaches the stores unnoticed.
// The prices of a store and the discount rules of the network in the change feed (spec 2026-10-16-offline-sync,
// E21, section 5.1). A price is an entity of its store (`entityId` = the product): the feed reader filters the scope,
// so the row read here is the one of the store reading the feed. A rule goes with its thresholds and stores.
@Injectable()
export class PricingFeed implements FeedSource {
  readonly entityTypes: readonly SyncEntityType[] = [
    'store_price',
    'discount_rule',
  ];

  constructor(sources: SyncFeedSources) {
    sources.register(this);
  }

  async read(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    entityType: SyncEntityType,
    ids: readonly string[],
  ): Promise<Map<string, SyncEntityData>> {
    const out = new Map<string, SyncEntityData>();
    if (ids.length === 0) return out;
    if (entityType === 'store_price') {
      const rows = await trx
        .selectFrom('storeProducts')
        .select([
          'storeId',
          'productId',
          'retailPricePerPackDirams',
          'retailPricePerPieceDirams',
          'priceVersion',
          'priceChangedAt',
          'priceChangedBy',
          'priceSource',
          'createdAt',
          'updatedAt',
        ])
        .where('tenantId', '=', tenantId)
        .where('storeId', '=', storeId)
        .where('productId', 'in', [...ids])
        .execute();
      for (const row of rows) {
        out.set(row.productId, { storeProducts: [feedRow(row)] });
      }
      return out;
    }
    if (entityType !== 'discount_rule') {
      throw new Error(`PricingFeed does not read ${entityType}`);
    }
    const rules = await trx
      .selectFrom('discountRules')
      .select([
        'id',
        'name',
        'level',
        'storeScope',
        'validFrom',
        'validTo',
        'status',
        'archivedAt',
        'createdBy',
        'createdAt',
        'updatedAt',
      ])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute();
    const tiers = await trx
      .selectFrom('discountRuleTiers')
      .select(['ruleId', 'minTotalDirams', 'percentBp', 'createdAt'])
      .where('tenantId', '=', tenantId)
      .where('ruleId', 'in', [...ids])
      .orderBy('minTotalDirams')
      .execute();
    const stores = await trx
      .selectFrom('discountRuleStores')
      .select(['ruleId', 'storeId', 'createdAt'])
      .where('tenantId', '=', tenantId)
      .where('ruleId', 'in', [...ids])
      .execute();
    for (const rule of rules) {
      out.set(rule.id, {
        discountRules: [feedRow(rule)],
        discountRuleTiers: tiers
          .filter((t) => t.ruleId === rule.id)
          .map(feedRow),
        discountRuleStores: stores
          .filter((s) => s.ruleId === rule.id)
          .map(feedRow),
      });
    }
    return out;
  }
}
