import { Injectable } from '@nestjs/common';
import type { SyncEntityData, SyncEntityType } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import { type FeedSource, feedRow, SyncFeedSources } from '../../core/sync';

// The columns of the feed, version 1 (spec E7): named, so that a column added to a table never reaches the stores
// unnoticed — a new column is a new version of the entity. The tenant is the store's own.
const PRODUCT_COLUMNS = [
  'id',
  'name',
  'inn',
  'dosageForm',
  'dosage',
  'manufacturer',
  'country',
  'unit',
  'piecesPerPack',
  'soldByPiece',
  'isPrescription',
  'isControlled',
  'isPriceRegulated',
  'maxRetailPricePerPackDirams',
  'categoryId',
  'markupBp',
  'defaultMinStockPieces',
  'article',
  'status',
  'archivedAt',
  'origin',
  'createdAtStoreId',
  'mergedIntoProductId',
  'createdAt',
  'updatedAt',
] as const;
const CATEGORY_COLUMNS = [
  'id',
  'name',
  'markupBp',
  'posSortOrder',
  'status',
  'archivedAt',
  'createdAt',
  'updatedAt',
] as const;

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
        .select(CATEGORY_COLUMNS)
        .where('tenantId', '=', tenantId)
        .where('id', 'in', [...ids])
        .execute();
      for (const row of rows) out.set(row.id, { categories: [feedRow(row)] });
      return out;
    }
    if (entityType !== 'product') {
      throw new Error(`CatalogFeed does not read ${entityType}`);
    }
    const products = await trx
      .selectFrom('products')
      .select(PRODUCT_COLUMNS)
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute();
    const barcodes = await trx
      .selectFrom('productBarcodes')
      .select(['barcode', 'productId', 'createdAt'])
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
