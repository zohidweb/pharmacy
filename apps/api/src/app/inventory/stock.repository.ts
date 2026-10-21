import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface BatchStockRow {
  batchId: string;
  storeId: string;
  productId: string;
  supplierId: string | null;
  /** The document that created the batch. */
  sourceDocumentId: string;
  lotNumber: string | null;
  expiryDate: string;
  purchasePricePerPackDirams: bigint;
  qty: number;
}

/** Narrows the batches in SQL, before their stock is summed. */
export interface BatchFilter {
  supplierId?: string;
  /** The document that created the batch (a goods receipt). */
  sourceDocumentId?: string;
  /** Batches that expired before this date. */
  expiredBefore?: string;
}

// The stock of batches: the sum of their movements (data model 03 — stock is never stored). The
// index (tenant_id, store_id, batch_id) include (qty_delta_pieces) answers it without the table.
@Injectable()
export class StockRepository {
  /** Batches with a non-zero stock in the stores, optionally of some products only. */
  /** Whether the store has any stock movement — the warning of a load of opening balances (F13). */
  async hasMovements(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<boolean> {
    const result = await sql<{ found: boolean }>`
      select exists (
        select 1 from pharmacy.stock_movements
        where tenant_id = ${tenantId} and store_id = ${storeId}) as found`.execute(
      trx,
    );
    return result.rows[0]?.found === true;
  }

  async batchStock(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    productIds: readonly string[] | null,
    filter: BatchFilter = {},
  ): Promise<BatchStockRow[]> {
    if (
      storeIds.length === 0 ||
      (productIds !== null && productIds.length === 0)
    )
      return [];
    const result = await sql<BatchStockRow>`
      select b.id as batch_id, b.store_id, b.product_id, b.supplier_id, b.source_document_id,
             b.lot_number,
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
        ${filter.supplierId === undefined ? sql`` : sql`and b.supplier_id = ${filter.supplierId}`}
        ${filter.sourceDocumentId === undefined ? sql`` : sql`and b.source_document_id = ${filter.sourceDocumentId}`}
        ${filter.expiredBefore === undefined ? sql`` : sql`and b.expiry_date < ${filter.expiredBefore}::date`}
        and s.qty <> 0
      order by b.expiry_date, b.id`.execute(trx);
    return result.rows;
  }

  /**
   * Batches with stock that expired before `today` or expire by `soon` (both dates of the network),
   * counted in one query: the list KPIs need the counts, not every batch of the stores.
   */
  async expiryCounts(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    today: string,
    soon: string,
  ): Promise<{ expired: number; expiring: number }> {
    if (storeIds.length === 0) return { expired: 0, expiring: 0 };
    const result = await sql<{ expired: number; expiring: number }>`
      select count(*) filter (where b.expiry_date < ${today}::date)::integer as expired,
             count(*) filter (where b.expiry_date >= ${today}::date)::integer as expiring
      from pharmacy.batches b
      join lateral (
        select sum(m.qty_delta_pieces) as qty
        from pharmacy.stock_movements m
        where m.tenant_id = b.tenant_id and m.store_id = b.store_id and m.batch_id = b.id
      ) s on true
      where b.tenant_id = ${tenantId}
        and b.store_id in (${sql.join([...storeIds])})
        and b.expiry_date <= ${soon}::date
        and s.qty > 0`.execute(trx);
    return result.rows[0];
  }

  /** Pieces sold at the store by product since a business date (exclusive). */
  async soldPieces(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    productIds: readonly string[],
    after: string,
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const result = await sql<{ productId: string; pieces: number }>`
      select b.product_id, (-sum(m.qty_delta_pieces))::integer as pieces
      from pharmacy.stock_movements m
      join pharmacy.batches b on b.tenant_id = m.tenant_id and b.id = m.batch_id
      where m.tenant_id = ${tenantId} and m.store_id = ${storeId} and m.kind = 'sale'
        and m.business_date > ${after}::date
        and b.product_id in (${sql.join([...productIds])})
      group by b.product_id`.execute(trx);
    return new Map(result.rows.map((r) => [r.productId, r.pieces]));
  }

  /** The purchase price of a pack in the last goods receipt: of the supplier first, else any. */
  async lastPurchasePrices(
    trx: TenantTransaction,
    tenantId: string,
    productIds: readonly string[],
    supplierId: string | null,
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const result = await sql<{ productId: string; price: bigint }>`
      select distinct on (b.product_id) b.product_id, b.purchase_price_per_pack_dirams as price
      from pharmacy.batches b
      where b.tenant_id = ${tenantId} and b.origin = 'goods_receipt'
        and b.product_id in (${sql.join([...productIds])})
      order by b.product_id, (b.supplier_id is not distinct from ${supplierId}::uuid) desc,
               b.created_at desc, b.id desc`.execute(trx);
    return new Map(result.rows.map((r) => [r.productId, Number(r.price)]));
  }

  /** The stock of batches of a store, pieces (absent — no movements). */
  async stockOfBatches(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    batchIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (batchIds.length === 0) return new Map();
    const result = await sql<{ batchId: string; qty: number }>`
      select m.batch_id, sum(m.qty_delta_pieces)::integer as qty
      from pharmacy.stock_movements m
      where m.tenant_id = ${tenantId} and m.store_id = ${storeId}
        and m.batch_id in (${sql.join([...batchIds])})
      group by m.batch_id`.execute(trx);
    return new Map(result.rows.map((r) => [r.batchId, r.qty]));
  }
}
