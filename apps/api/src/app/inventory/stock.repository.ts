import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface BatchStockRow {
  batchId: string;
  storeId: string;
  productId: string;
  lotNumber: string | null;
  expiryDate: string;
  purchasePricePerPackDirams: bigint;
  qty: number;
}

// The stock of batches: the sum of their movements (data model 03 — stock is never stored). The
// index (tenant_id, store_id, batch_id) include (qty_delta_pieces) answers it without the table.
@Injectable()
export class StockRepository {
  /** Batches with a non-zero stock in the stores, optionally of some products only. */
  async batchStock(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    productIds: readonly string[] | null,
  ): Promise<BatchStockRow[]> {
    if (
      storeIds.length === 0 ||
      (productIds !== null && productIds.length === 0)
    )
      return [];
    const result = await sql<BatchStockRow>`
      select b.id as batch_id, b.store_id, b.product_id, b.lot_number,
             b.expiry_date::text as expiry_date, b.purchase_price_per_pack_dirams,
             s.qty
      from pharmacy.batches b
      join lateral (
        select sum(m.qty_delta_pieces)::integer as qty
        from pharmacy.stock_movements m
        where m.tenant_id = b.tenant_id and m.store_id = b.store_id and m.batch_id = b.id
      ) s on true
      where b.tenant_id = ${tenantId}
        and b.store_id in (${sql.join([...storeIds])})
        ${productIds === null ? sql`` : sql`and b.product_id in (${sql.join([...productIds])})`}
        and s.qty <> 0
      order by b.expiry_date, b.id`.execute(trx);
    return result.rows;
  }
}
