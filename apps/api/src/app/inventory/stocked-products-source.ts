import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { StockedProducts } from '../pricing/stocked-products';

// The products in stock at the stores for the price problems (spec 2026-10-15-nav-counters, E5, E6):
// a product with positive stock and no price cannot be sold at the till. Stock is the sum of the
// movements of the batches of the product at the store.
@Injectable()
export class StockedProductsSource {
  constructor(stocked: StockedProducts) {
    stocked.register((trx, tenantId, storeIds, productIds) =>
      this.stockedAt(trx, tenantId, storeIds, productIds),
    );
  }

  private async stockedAt(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    productIds: readonly string[] | undefined,
  ): Promise<Set<string>> {
    const result = await sql<{ storeId: string; productId: string }>`
      select b.store_id, b.product_id
      from pharmacy.batches b
      join pharmacy.stock_movements m
        on m.tenant_id = b.tenant_id and m.store_id = b.store_id and m.batch_id = b.id
      where b.tenant_id = ${tenantId}
        and b.store_id = any(${sql.val([...storeIds])}::uuid[])
        ${productIds === undefined ? sql`` : sql`and b.product_id = any(${sql.val([...productIds])}::uuid[])`}
      group by b.store_id, b.product_id
      having sum(m.qty_delta_pieces) > 0`.execute(trx);
    return new Set(result.rows.map((row) => `${row.storeId}/${row.productId}`));
  }
}
