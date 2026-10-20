import { Injectable } from '@nestjs/common';
import type { SyncEntityData, SyncEntityType } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import { type FeedSource, feedRow, SyncFeedSources } from '../../core/sync';

// The products and categories of the network in the change feed (spec 2026-10-16-offline-sync, E21, section 5.1):
// their rows as the cloud stores them — a product with its barcodes — for the store to upsert by id.
@Injectable()
export class CatalogFeed implements FeedSource {
  readonly entityTypes: readonly SyncEntityType[] = ['product', 'category'];

  constructor(sources: SyncFeedSources) {
    sources.register(this);
  }

  async read(
    trx: TenantTransaction,
    tenantId: string,
    _storeId: string,
    entityType: SyncEntityType,
    ids: readonly string[],
  ): Promise<Map<string, SyncEntityData>> {
    const out = new Map<string, SyncEntityData>();
    if (ids.length === 0) return out;
    if (entityType === 'category') {
      const rows = await trx
        .selectFrom('categories')
        .selectAll()
        .where('tenantId', '=', tenantId)
        .where('id', 'in', [...ids])
        .execute();
      for (const row of rows) out.set(row.id, { categories: [feedRow(row)] });
      return out;
    }
    const products = await trx
      .selectFrom('products')
      .selectAll()
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute();
    const barcodes = await trx
      .selectFrom('productBarcodes')
      .selectAll()
      .where('tenantId', '=', tenantId)
      .where('productId', 'in', [...ids])
      .orderBy('barcode')
      .execute();
    for (const product of products) {
      out.set(product.id, {
        products: [feedRow(product)],
        productBarcodes: barcodes
          .filter((b) => b.productId === product.id)
          .map(feedRow),
      });
    }
    return out;
  }
}
