import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { DocumentsRepository } from './documents.repository';
import { StockRepository } from './stock.repository';

/** A batch of a store as the POS sees it, with its stock. */
export interface PosBatchRow {
  id: string;
  productId: string;
  lotNumber: string | null;
  /** YYYY-MM-DD */
  expiryDate: string;
  stockPieces: number;
  purchasePricePerPackDirams: bigint;
  costPerPieceDirams: bigint;
}

/** A sale line that moves a batch: `qtyPieces` pieces leave it. */
export interface SaleMovement {
  storeId: string;
  batchId: string;
  qtyPieces: number;
  receiptId: string;
  lineId: string;
  businessDate: string;
}

// The public interface of the stock for the POS (ADR-0002; spec 2026-10-13-pos-shift-sale, 4.3 and
// 4.5): the batches and their stock for the snapshot, the lock of the sold batches and the `sale`
// movements of a receipt. Stock is the sum of the movements (data model 03). Runs in the caller's
// transaction.
@Injectable()
export class PosStock {
  constructor(
    private readonly documents: DocumentsRepository,
    private readonly stock: StockRepository,
  ) {}

  /** Batches of the store with stock > 0, of the products or every one (null). */
  async batchesWithStock(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    productIds: readonly string[] | null,
  ): Promise<PosBatchRow[]> {
    if (productIds !== null && productIds.length === 0) return [];
    // one pass over the movements of the store (index-only on the batch index), then the batches
    const result = await sql<PosBatchRow>`
      select b.id, b.product_id, b.lot_number, b.expiry_date::text as expiry_date,
             s.qty as stock_pieces, b.purchase_price_per_pack_dirams, b.cost_per_piece_dirams
      from (
        select m.batch_id, sum(m.qty_delta_pieces)::integer as qty
        from pharmacy.stock_movements m
        where m.tenant_id = ${tenantId} and m.store_id = ${storeId}
        group by m.batch_id
        having sum(m.qty_delta_pieces) > 0
      ) s
      join pharmacy.batches b on b.tenant_id = ${tenantId} and b.id = s.batch_id
      ${productIds === null ? sql`` : sql`where b.product_id in (${sql.join([...productIds])})`}
      order by b.product_id, b.expiry_date, b.id`.execute(trx);
    return result.rows;
  }

  /**
   * Products whose batches moved at the store after a moment, by the moment of the write (a
   * backdated document has an old business date but a new write): the monthly partitions by
   * `recorded_at` keep the scan to the last ones.
   */
  async productsMovedSince(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    since: Date,
  ): Promise<string[]> {
    const result = await sql<{ productId: string }>`
      select distinct b.product_id
      from pharmacy.stock_movements m
      join pharmacy.batches b on b.tenant_id = m.tenant_id and b.id = m.batch_id
      where m.tenant_id = ${tenantId} and m.store_id = ${storeId}
        and m.recorded_at > ${since}`.execute(trx);
    return result.rows.map((row) => row.productId);
  }

  /**
   * Locks the batches of the store (`FOR UPDATE` in the order of ids — no deadlock between two
   * terminals), then reads their stock (ADR-0006: the lock and the count are separate statements).
   * A batch of another store is absent from the map.
   */
  async lockBatches(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    batchIds: readonly string[],
  ): Promise<Map<string, PosBatchRow>> {
    const ids = [...new Set(batchIds)].sort();
    if (ids.length === 0) return new Map();
    const rows = await sql<Omit<PosBatchRow, 'stockPieces'>>`
      select b.id, b.product_id, b.lot_number, b.expiry_date::text as expiry_date,
             b.purchase_price_per_pack_dirams, b.cost_per_piece_dirams
      from pharmacy.batches b
      where b.tenant_id = ${tenantId} and b.store_id = ${storeId}
        and b.id in (${sql.join(ids)})
      order by b.id for update`.execute(trx);
    const stock = await this.stock.stockOfBatches(
      trx,
      tenantId,
      storeId,
      rows.rows.map((row) => row.id),
    );
    return new Map(
      rows.rows.map((row) => [
        row.id,
        { ...row, stockPieces: stock.get(row.id) ?? 0 },
      ]),
    );
  }

  /** Products of the batches of the store, without a lock (a held receipt): batch → product. */
  async productsOfBatches(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    batchIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(batchIds)];
    if (ids.length === 0) return new Map();
    const result = await sql<{ id: string; productId: string }>`
      select b.id, b.product_id from pharmacy.batches b
      where b.tenant_id = ${tenantId} and b.store_id = ${storeId}
        and b.id in (${sql.join(ids)})`.execute(trx);
    return new Map(result.rows.map((row) => [row.id, row.productId]));
  }

  /** The `sale` movements of a receipt (−pieces, source `receipt`). */
  recordSale(
    trx: TenantTransaction,
    tenantId: string,
    movements: readonly SaleMovement[],
  ): Promise<void> {
    return this.documents.insertMovements(
      trx,
      tenantId,
      movements.map((m) => ({
        storeId: m.storeId,
        batchId: m.batchId,
        qtyDeltaPieces: -m.qtyPieces,
        kind: 'sale',
        sourceId: m.receiptId,
        sourceLineId: m.lineId,
        businessDate: m.businessDate,
        reversesMovementId: null,
        sourceType: 'receipt',
      })),
    );
  }
}
