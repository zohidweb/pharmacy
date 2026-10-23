import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type TenantTransaction, tenantToday } from '../../core/database';
import { StorePriceWriter } from '../pricing/store-price-writer';

export interface LowStockOfStore {
  storeId: string;
  /** Products of the assortment of the store below their minimum (zero included). */
  positions: number;
}

export interface StockSignals {
  lines: LowStockLine[];
  /** Keys `${storeId}/${productId}` of the products with positive stock at the stores. */
  stocked: Set<string>;
}

export interface LowStockLine {
  storeId: string;
  productId: string;
  /** Stock of the product at the store, pieces; negative after merging an offline store. */
  qtyPieces: number;
  minPieces: number;
}

export interface ExpiringBatch {
  batchId: string;
  storeId: string;
  productId: string;
  /** Language map of the name of the product. */
  productName: unknown;
  lotNumber: string | null;
  expiryDate: string;
  qtyPieces: number;
  piecesPerPack: number;
}

export interface TransferInTransit {
  documentId: string;
  number: string;
  fromStoreId: string;
  toStoreId: string;
  positions: number;
}

const storeFilter = (column: string, storeIds?: readonly string[]) =>
  storeIds === undefined
    ? sql``
    : sql`and ${sql.raw(column)} = any(${sql.val([...storeIds])}::uuid[])`;

// The stock signals of the notifications and the home (spec 2026-10-14-owner-cabinet, E4, 5.4):
// products below their minimum, batches near their expiry, transfers on the way. Every method reads
// the given stores, or every store of the network without them.
@Injectable()
export class StockAlerts {
  constructor(private readonly prices: StorePriceWriter) {}

  /** Products below the minimum by store — the count of `lowStockLines` (E4). */
  async lowStock(
    trx: TenantTransaction,
    tenantId: string,
    storeIds?: readonly string[],
  ): Promise<LowStockOfStore[]> {
    const byStore = new Map<string, number>();
    for (const line of await this.lowStockLines(trx, tenantId, storeIds)) {
      byStore.set(line.storeId, (byStore.get(line.storeId) ?? 0) + 1);
    }
    return [...byStore].map(([storeId, positions]) => ({ storeId, positions }));
  }

  /**
   * Products below the minimum one by one: the assortment of the stock screen — a product the store
   * holds stock of or has a price for — active, with a minimum, and a stock under it (E4). One rule
   * for the home tile, the notification, the menu counter and the list «Надо заказать»
   * (spec 2026-10-15-nav-counters, E3, N4).
   */
  async lowStockLines(
    trx: TenantTransaction,
    tenantId: string,
    storeIds?: readonly string[],
  ): Promise<LowStockLine[]> {
    return (await this.stockSignals(trx, tenantId, storeIds)).lines;
  }

  /**
   * `lowStockLines` and the products in stock from one pass over the movements: the menu counters
   * (spec 2026-10-15-nav-counters) need both every minute.
   */
  async stockSignals(
    trx: TenantTransaction,
    tenantId: string,
    storeIds?: readonly string[],
  ): Promise<StockSignals> {
    if (storeIds !== undefined && storeIds.length === 0) {
      return { lines: [], stocked: new Set() };
    }
    const stock = await sql<{
      storeId: string;
      productId: string;
      qty: number;
    }>`
      select b.store_id, b.product_id, sum(m.qty_delta_pieces)::integer as qty
      from pharmacy.batches b
      join pharmacy.stock_movements m
        on m.tenant_id = b.tenant_id and m.store_id = b.store_id and m.batch_id = b.id
      where b.tenant_id = ${tenantId} ${storeFilter('b.store_id', storeIds)}
      group by b.store_id, b.product_id
      having sum(m.qty_delta_pieces) <> 0`.execute(trx);
    const totals = new Map(
      stock.rows.map((row) => [`${row.storeId}/${row.productId}`, row.qty]),
    );
    const stocked = new Set(
      [...totals].filter(([, qty]) => qty > 0).map(([key]) => key),
    );
    const allStores =
      storeIds ??
      (
        await sql<{ id: string }>`
          select id from pharmacy.stores
          where tenant_id = ${tenantId} and status = 'active'`.execute(trx)
      ).rows.map((row) => row.id);
    const priced = await this.prices.pricedAt(trx, tenantId, allStores);
    const pairs = new Set([...totals.keys(), ...priced.keys()]);
    const productIds = [...new Set([...pairs].map((key) => key.split('/')[1]))];
    if (productIds.length === 0) return { lines: [], stocked };
    const products = await sql<{ id: string; minPieces: number }>`
      select id, default_min_stock_pieces as min_pieces
      from pharmacy.products
      where tenant_id = ${tenantId} and status = 'active'
        and default_min_stock_pieces > 0
        and id = any(${sql.val(productIds)}::uuid[])`.execute(trx);
    const minimum = new Map(
      products.rows.map((row) => [row.id, row.minPieces]),
    );
    const lines: LowStockLine[] = [];
    for (const key of pairs) {
      const [storeId, productId] = key.split('/');
      const min = minimum.get(productId);
      const qty = totals.get(key) ?? 0;
      if (min === undefined || qty >= min) continue;
      lines.push({ storeId, productId, qtyPieces: qty, minPieces: min });
    }
    return { lines, stocked };
  }

  /** Batches with stock that expire within `thresholdDays` of today, the expired ones included. */
  async expiringBatches(
    trx: TenantTransaction,
    tenantId: string,
    thresholdDays: number,
    storeIds?: readonly string[],
  ): Promise<ExpiringBatch[]> {
    if (storeIds !== undefined && storeIds.length === 0) return [];
    const result = await sql<ExpiringBatch>`
      select b.id as batch_id, b.store_id, b.product_id, p.name as product_name,
             b.lot_number, b.expiry_date::text as expiry_date, s.qty as qty_pieces,
             p.pieces_per_pack
      from pharmacy.batches b
      join pharmacy.products p on p.tenant_id = b.tenant_id and p.id = b.product_id
      join lateral (
        select sum(m.qty_delta_pieces)::integer as qty
        from pharmacy.stock_movements m
        where m.tenant_id = b.tenant_id and m.store_id = b.store_id and m.batch_id = b.id
      ) s on true
      where b.tenant_id = ${tenantId} ${storeFilter('b.store_id', storeIds)}
        and b.expiry_date <= ${tenantToday(tenantId)} + ${thresholdDays}::integer
        and s.qty > 0
      order by b.expiry_date, b.id`.execute(trx);
    return result.rows;
  }

  /** Transfers on the way to the stores (the receiver's), with the number of their lines. */
  async transfersInTransit(
    trx: TenantTransaction,
    tenantId: string,
    storeIds?: readonly string[],
  ): Promise<TransferInTransit[]> {
    if (storeIds !== undefined && storeIds.length === 0) return [];
    const result = await sql<TransferInTransit>`
      select d.id as document_id, d.number, d.store_id as from_store_id,
             d.destination_store_id as to_store_id,
             (select count(*) from pharmacy.transfer_lines l
              where l.tenant_id = d.tenant_id and l.document_id = d.id)::integer as positions
      from pharmacy.documents d
      where d.tenant_id = ${tenantId} and d.type = 'transfer' and d.status = 'in_transit'
        ${storeFilter('d.destination_store_id', storeIds)}
      order by d.dispatched_at`.execute(trx);
    return result.rows;
  }
}
