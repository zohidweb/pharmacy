import { Injectable } from '@nestjs/common';
import { piecePriceMinor } from '@pharmacy/shared-domain';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { StorePricesReader } from '../pricing/store-prices-reader';

export interface LossesOfStore {
  storeId: string;
  /** Write-offs at cost (a loss is positive). */
  writeOffMinor: number;
  /** Stock-count shortages less surpluses at cost (a loss is positive). */
  stockCountMinor: number;
}

export interface LossLine {
  documentId: string;
  number: string;
  /** YYYY-MM-DD — the date of the document. */
  date: string;
  storeId: string;
  productId: string;
  /** WriteOffReason, or `stock_count` for a stock-count shortage. */
  reason: string;
  /** Pieces lost (positive). */
  qtyPieces: number;
  piecesPerPack: number;
  amountMinor: number;
}

export interface MovementOfProduct {
  productId: string;
  piecesPerPack: number;
  opening: number;
  receipt: number;
  transfers: number;
  sales: number;
  supplierReturns: number;
  writeOffs: number;
  stockCount: number;
  closing: number;
}

export interface StockOfStore {
  storeId: string;
  positions: number;
  costMinor: number;
  retailMinor: number;
  low: number;
  expiring: number;
}

export interface ControlledBalance {
  productId: string;
  storeId: string;
  piecesPerPack: number;
  opening: number;
  received: number;
  /** Positive. */
  issued: number;
  closing: number;
}

const stores = (storeIds: readonly string[]) => sql.val([...storeIds]);

// The movements of the stores with the kind of each one — a reversal counts as the movement it
// reverses, on its own date: a document posted and unposted in a period gives nothing (spec
// 2026-10-14-owner-cabinet, E3).
// The reversed kind comes from a hash join: a scalar subquery per reversal row (final review I3) was
// measured slower — a correlated subplan keeps the aggregation out of the parallel workers (movement
// 0.9 s → 4.2 s on 2M movements). `controlledOnly` keeps the movements of the ПКУ products.
const movements = (
  tenantId: string,
  storeIds: readonly string[],
  controlledOnly = false,
) => sql`
  select m.store_id, b.product_id, m.batch_id, m.qty_delta_pieces as qty, m.business_date,
         coalesce(o.kind, m.kind) as kind, b.cost_per_piece_dirams as cost
  from pharmacy.stock_movements m
  join pharmacy.batches b on b.tenant_id = m.tenant_id and b.id = m.batch_id
  ${
    controlledOnly
      ? sql`join pharmacy.products cp
              on cp.tenant_id = b.tenant_id and cp.id = b.product_id and cp.is_controlled`
      : sql``
  }
  left join pharmacy.stock_movements o
    on m.kind = 'reversal' and o.tenant_id = m.tenant_id and o.id = m.reverses_movement_id
  where m.tenant_id = ${tenantId} and m.store_id = any(${stores(storeIds)}::uuid[])`;

// The stock figures of the reports (spec 2026-10-14-owner-cabinet, 5.3): losses at cost, the movement
// of the products, the stock at a date and the balance of the ПКУ products, in pieces.
@Injectable()
export class StockFigures {
  constructor(private readonly prices: StorePricesReader) {}

  async lossesByStore(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<LossesOfStore[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      storeId: string;
      writeOffMinor: string;
      stockCountMinor: string;
    }>`
      with mv as (${movements(tenantId, storeIds)}
        and m.business_date between ${from}::date and ${to}::date
        and m.kind in ('write_off', 'inventory_loss', 'inventory_gain', 'reversal'))
      select store_id,
             coalesce(sum(-qty * cost) filter (where kind = 'write_off'), 0) as write_off_minor,
             coalesce(sum(-qty * cost)
               filter (where kind in ('inventory_loss', 'inventory_gain')), 0) as stock_count_minor
      from mv
      where kind in ('write_off', 'inventory_loss', 'inventory_gain')
      group by store_id`.execute(trx);
    return result.rows.map((row) => ({
      storeId: row.storeId,
      writeOffMinor: Number(row.writeOffMinor),
      stockCountMinor: Number(row.stockCountMinor),
    }));
  }

  /**
   * The lines of the posted write-offs and the shortages of the posted stock counts dated in the
   * period: one line per document × product, losses only.
   */
  async lossLines(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<LossLine[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<
      Omit<LossLine, 'amountMinor'> & { amountMinor: string }
    >`
      select d.id as document_id, d.number, d.document_date::text as date, d.store_id,
             b.product_id,
             case when d.type = 'write_off' then d.write_off_reason else 'stock_count' end as reason,
             (-sum(m.qty_delta_pieces))::integer as qty_pieces, p.pieces_per_pack,
             sum(-m.qty_delta_pieces * b.cost_per_piece_dirams) as amount_minor
      from pharmacy.documents d
      join pharmacy.stock_movements m
        on m.tenant_id = d.tenant_id and m.source_type = 'document' and m.source_id = d.id
      join pharmacy.batches b on b.tenant_id = m.tenant_id and b.id = m.batch_id
      join pharmacy.products p on p.tenant_id = b.tenant_id and p.id = b.product_id
      left join pharmacy.stock_movements o
        on m.kind = 'reversal' and o.tenant_id = m.tenant_id and o.id = m.reverses_movement_id
      where d.tenant_id = ${tenantId} and d.status = 'posted'
        and d.type in ('write_off', 'inventory')
        and d.store_id = any(${stores(storeIds)}::uuid[])
        and d.document_date between ${from}::date and ${to}::date
        and coalesce(o.kind, m.kind) in ('write_off', 'inventory_loss')
      group by d.id, d.number, d.document_date, d.store_id, b.product_id, d.type,
               d.write_off_reason, p.pieces_per_pack
      having sum(m.qty_delta_pieces) < 0
      order by d.document_date desc, d.number desc`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      amountMinor: Number(row.amountMinor),
    }));
  }

  /** Signed pieces by product over the stores: the opening before `from`, the period, the closing. */
  async movement(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<MovementOfProduct[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<MovementOfProduct>`
      with mv as (${movements(tenantId, storeIds)}
        and m.business_date <= ${to}::date)
      select mv.product_id, p.pieces_per_pack,
        coalesce(sum(qty) filter (where business_date < ${from}::date), 0)::integer as opening,
        coalesce(sum(qty) filter (where business_date >= ${from}::date
          and kind in ('goods_receipt', 'opening_balance')), 0)::integer as receipt,
        coalesce(sum(qty) filter (where business_date >= ${from}::date
          and kind in ('transfer_in', 'transfer_out')), 0)::integer as transfers,
        coalesce(sum(qty) filter (where business_date >= ${from}::date
          and kind in ('sale', 'customer_return')), 0)::integer as sales,
        coalesce(sum(qty) filter (where business_date >= ${from}::date
          and kind = 'supplier_return'), 0)::integer as supplier_returns,
        coalesce(sum(qty) filter (where business_date >= ${from}::date
          and kind = 'write_off'), 0)::integer as write_offs,
        coalesce(sum(qty) filter (where business_date >= ${from}::date
          and kind in ('inventory_gain', 'inventory_loss')), 0)::integer as stock_count,
        coalesce(sum(qty), 0)::integer as closing
      from mv
      join pharmacy.products p on p.tenant_id = ${tenantId} and p.id = mv.product_id
      group by mv.product_id, p.pieces_per_pack
      having count(*) filter (where business_date >= ${from}::date) > 0
        or coalesce(sum(qty) filter (where business_date < ${from}::date), 0) <> 0`.execute(
      trx,
    );
    return result.rows;
  }

  /** The stock of the stores at the end of `date`, at cost and at the current retail prices. */
  async stockAt(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    date: string,
    thresholdDays: number,
  ): Promise<StockOfStore[]> {
    if (storeIds.length === 0) return [];
    const batches = await sql<{
      storeId: string;
      productId: string;
      expiryDate: string;
      cost: string;
      qty: number;
    }>`
      select b.store_id, b.product_id, b.expiry_date::text as expiry_date,
             b.cost_per_piece_dirams as cost, sum(m.qty_delta_pieces)::integer as qty
      from pharmacy.stock_movements m
      join pharmacy.batches b on b.tenant_id = m.tenant_id and b.id = m.batch_id
      where m.tenant_id = ${tenantId} and m.store_id = any(${stores(storeIds)}::uuid[])
        and m.business_date <= ${date}::date
      group by b.id, b.store_id, b.product_id, b.expiry_date, b.cost_per_piece_dirams
      having sum(m.qty_delta_pieces) <> 0`.execute(trx);
    const step = await sql<{ step: number }>`
      select coalesce(ts.piece_price_rounding_dirams, 10) as step
      from (select 1) one
      left join pharmacy.tenant_settings ts on ts.tenant_id = ${tenantId}`.execute(
      trx,
    );
    const expiringBy = new Date(`${date}T00:00:00Z`);
    expiringBy.setUTCDate(expiringBy.getUTCDate() + thresholdDays);
    const expiringLimit = expiringBy.toISOString().slice(0, 10);
    const result: StockOfStore[] = [];
    for (const storeId of storeIds) {
      const ofStore = batches.rows.filter((row) => row.storeId === storeId);
      const prices = await this.prices.pricesOfStore(
        trx,
        tenantId,
        storeId,
        null,
      );
      const totals = new Map<string, number>();
      for (const row of ofStore) {
        totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.qty);
      }
      const productIds = [...new Set([...totals.keys(), ...prices.keys()])];
      const products =
        productIds.length === 0
          ? []
          : (
              await sql<{
                id: string;
                piecesPerPack: number;
                minPieces: number | null;
                status: string;
              }>`
                select id, pieces_per_pack, default_min_stock_pieces as min_pieces, status
                from pharmacy.products
                where tenant_id = ${tenantId} and id = any(${sql.val(productIds)}::uuid[])`.execute(
                trx,
              )
            ).rows;
      const productOf = new Map(products.map((p) => [p.id, p]));
      let retailMinor = 0;
      let positions = 0;
      let low = 0;
      for (const productId of productIds) {
        const product = productOf.get(productId);
        if (!product) continue;
        const qty = totals.get(productId) ?? 0;
        if (qty > 0) {
          positions += 1;
          const price = prices.get(productId);
          if (price) {
            const packs = Math.floor(qty / product.piecesPerPack);
            const rest = qty % product.piecesPerPack;
            retailMinor +=
              packs * price.packDirams +
              (rest === 0
                ? 0
                : rest *
                  piecePriceMinor(
                    price.packDirams,
                    product.piecesPerPack,
                    price.ownPieceDirams,
                    step.rows[0].step,
                  ));
          }
        }
        if (
          product.status === 'active' &&
          (product.minPieces ?? 0) > 0 &&
          qty < (product.minPieces ?? 0)
        ) {
          low += 1;
        }
      }
      result.push({
        storeId,
        positions,
        costMinor: ofStore.reduce(
          (sum, row) => sum + (row.qty > 0 ? row.qty * Number(row.cost) : 0),
          0,
        ),
        retailMinor,
        low,
        expiring: ofStore.filter(
          (row) => row.qty > 0 && row.expiryDate <= expiringLimit,
        ).length,
      });
    }
    return result;
  }

  /** The balance of the ПКУ products (`is_controlled`) by product × store, in pieces. */
  async controlledSummary(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<ControlledBalance[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<ControlledBalance>`
      with mv as (${movements(tenantId, storeIds, true)}
        and m.business_date <= ${to}::date)
      select mv.product_id, mv.store_id, p.pieces_per_pack,
        coalesce(sum(qty) filter (where business_date < ${from}::date), 0)::integer as opening,
        coalesce(sum(qty) filter (where business_date >= ${from}::date
          and kind in ('goods_receipt', 'opening_balance', 'transfer_in', 'customer_return',
                       'inventory_gain')), 0)::integer as received,
        coalesce(-sum(qty) filter (where business_date >= ${from}::date
          and kind in ('sale', 'write_off', 'transfer_out', 'supplier_return',
                       'inventory_loss')), 0)::integer as issued,
        coalesce(sum(qty), 0)::integer as closing
      from mv
      join pharmacy.products p on p.tenant_id = ${tenantId} and p.id = mv.product_id
      where p.is_controlled
      group by mv.product_id, mv.store_id, p.pieces_per_pack
      having count(*) filter (where business_date >= ${from}::date) > 0
        or coalesce(sum(qty) filter (where business_date < ${from}::date), 0) <> 0`.execute(
      trx,
    );
    return result.rows;
  }
}
