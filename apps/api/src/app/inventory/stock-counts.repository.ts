import { Injectable } from '@nestjs/common';
import { type RawBuilder, sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';

export interface CountLineRow {
  id: string;
  lineNo: number;
  productId: string;
  batchId: string | null;
  isFound: boolean;
  bookQtyPieces: number;
  countedQtyPieces: number | null;
  soldSinceStartPieces: number | null;
  surplusLotNumber: string | null;
  surplusExpiryDate: string | null;
  surplusPurchasePricePerPackDirams: bigint | null;
  surplusBatchId: string | null;
  /** Of the batch of the line (book or surplus). */
  lotNumber: string | null;
  expiryDate: string | null;
  costPerPieceDirams: bigint | null;
  /** The current stock of the batch of the line, pieces (0 without a batch). */
  stockPieces: number;
  /**
   * The stock of the batch at the first entry of the line (spec 2026-10-13-pos-shift-sale, K2): the
   * expected stock — a sale counts by the moment of the sale, the rest by its write. Null without an
   * entry or a batch.
   */
  stockAtFirstEntryPieces: number | null;
  /** Sold after the first entry, fixed at the posting. */
  soldAfterCountPieces: number | null;
}

export interface CountEntryRow {
  id: string;
  documentId: string;
  lineId: string;
  qtyPieces: number;
  enteredBy: string;
  enteredByName: string;
  enteredAt: Date;
}

export interface FoundLineValues {
  productId: string;
  lotNumber: string | null;
  expiryDate: string | null;
  /** undefined — keep the current price (a writer without the cost right). */
  purchasePricePerPackDirams?: number | null;
}

export interface CountSummaryRow {
  documentId: string;
  surplusLines: number;
  shortageLines: number;
  diffDirams: bigint;
}

// The lines and entries of stock counts (spec 2026-10-12-write-offs-stock-counts, section 3.2); the
// header lives in DocumentsRepository. The stock of a batch is the sum of its movements.
/**
 * The stock of the batch of a line (alias `line`) up to a moment (`at`): the expected stock of the
 * line (spec 2026-10-13-pos-shift-sale, K2). A sale counts by the moment of the sale — a receipt
 * of an outage sold before the count but delivered after the first entry is «sold before»; the
 * other movements by their write.
 */
const stockAt = (
  line: RawBuilder<unknown>,
  store: RawBuilder<unknown>,
  at: RawBuilder<unknown>,
) => sql`
  select sum(m.qty_delta_pieces) as qty
  from pharmacy.stock_movements m
  left join pharmacy.receipts r
    on m.source_type = 'receipt' and r.tenant_id = m.tenant_id and r.id = m.source_id
  -- the store too: the batch index is (tenant_id, store_id, batch_id)
  where m.tenant_id = ${line}.tenant_id and m.store_id = ${store} and m.batch_id = ${line}.batch_id
    and ${line}.batch_id is not null and ${at} is not null
    and coalesce(r.sold_at, m.recorded_at) <= ${at}`;

@Injectable()
export class StockCountsRepository {
  /** Locks the header against a posting or a cancellation; entries share it. */
  async shareHeader(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<void> {
    await sql`select id from pharmacy.documents
      where tenant_id = ${tenantId} and id = ${documentId} for share`.execute(
      trx,
    );
  }

  /**
   * The snapshot of a start: a line per batch of the store with stock ≠ 0 (of the products, or
   * every one), in one statement — a store may hold tens of thousands of batches. The number of
   * lines.
   */
  async snapshot(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    storeId: string,
    productIds: readonly string[] | null,
  ): Promise<number> {
    const result = await sql<{ n: number }>`
      with stock as (
        select b.id as batch_id, b.product_id, b.expiry_date, s.qty
        from pharmacy.batches b
        join lateral (
          select sum(m.qty_delta_pieces)::integer as qty
          from pharmacy.stock_movements m
          where m.tenant_id = b.tenant_id and m.store_id = b.store_id and m.batch_id = b.id
        ) s on true
        where b.tenant_id = ${tenantId} and b.store_id = ${storeId}
          ${productIds === null ? sql`` : sql`and b.product_id = any(${[...productIds]}::uuid[])`}
          -- a batch in the minus is counted too: the count fixes it (K4)
          and s.qty <> 0
      ), inserted as (
        insert into pharmacy.inventory_lines
          (tenant_id, id, document_id, line_no, product_id, batch_id, book_qty_pieces)
        select ${tenantId}, gen_random_uuid(), ${documentId},
               row_number() over (order by expiry_date, batch_id), product_id, batch_id, qty
        from stock
        returning 1
      )
      select count(*)::integer as n from inserted`.execute(trx);
    return result.rows[0].n;
  }

  async lines(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    lineId?: string,
  ): Promise<CountLineRow[]> {
    const result = await sql<CountLineRow>`
      select l.id, l.line_no, l.product_id, l.batch_id, l.is_found, l.book_qty_pieces,
             l.counted_qty_pieces, l.sold_since_start_pieces, l.surplus_lot_number,
             l.surplus_expiry_date::text as surplus_expiry_date,
             l.surplus_purchase_price_per_pack_dirams, l.surplus_batch_id,
             coalesce(b.lot_number, l.surplus_lot_number) as lot_number,
             coalesce(b.expiry_date::text, l.surplus_expiry_date::text) as expiry_date,
             b.cost_per_piece_dirams,
             coalesce(s.qty, 0)::integer as stock_pieces,
             case when l.batch_id is null or f.at is null then null
                  else coalesce(fe.qty, 0)::integer end as stock_at_first_entry_pieces,
             l.sold_after_count_pieces
      from pharmacy.inventory_lines l
      left join pharmacy.batches b
        on b.tenant_id = l.tenant_id and b.id = coalesce(l.batch_id, l.surplus_batch_id)
      left join lateral (
        select sum(m.qty_delta_pieces) as qty
        from pharmacy.stock_movements m
        where m.tenant_id = b.tenant_id and m.store_id = b.store_id and m.batch_id = b.id
      ) s on true
      left join lateral (
        select min(x.entered_at) as at from pharmacy.inventory_count_entries x
        where x.tenant_id = l.tenant_id and x.line_id = l.id
      ) f on true
      left join lateral (${stockAt(sql`l`, sql`b.store_id`, sql`f.at`)}) fe on true
      where l.tenant_id = ${tenantId} and l.document_id = ${documentId}
        ${lineId ? sql`and l.id = ${lineId}` : sql``}
      order by l.line_no`.execute(trx);
    return result.rows;
  }

  async entries(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    lineId?: string,
  ): Promise<CountEntryRow[]> {
    const result = await sql<CountEntryRow>`
      select e.id, e.document_id, e.line_id, e.qty_pieces, e.entered_by,
             emp.full_name as entered_by_name, e.entered_at
      from pharmacy.inventory_count_entries e
      join pharmacy.employees emp on emp.tenant_id = e.tenant_id and emp.id = e.entered_by
      where e.tenant_id = ${tenantId} and e.document_id = ${documentId}
        ${lineId ? sql`and e.line_id = ${lineId}` : sql``}
      order by e.entered_at, e.id`.execute(trx);
    return result.rows;
  }

  async isLineOf(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    lineId: string,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom('inventoryLines')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('documentId', '=', documentId)
      .where('id', '=', lineId)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** The result of a line fixed at the posting. */
  async setLineResult(
    trx: TenantTransaction,
    tenantId: string,
    lineId: string,
    result: {
      countedQtyPieces: number;
      soldSinceStartPieces: number;
      soldAfterCountPieces?: number;
      surplusBatchId?: string;
    },
  ): Promise<void> {
    await trx
      .updateTable('inventoryLines')
      .set(result)
      .where('tenantId', '=', tenantId)
      .where('id', '=', lineId)
      .execute();
  }

  /** What was sold before and after the count of each line, fixed at a cancel (one statement). */
  async fixSold(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly {
      lineId: string;
      soldSinceStartPieces: number;
      soldAfterCountPieces: number;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await sql`
      update pharmacy.inventory_lines l
      set sold_since_start_pieces = v.sold_since, sold_after_count_pieces = v.sold_after
      from unnest(${rows.map((r) => r.lineId)}::uuid[],
                  ${rows.map((r) => r.soldSinceStartPieces)}::integer[],
                  ${rows.map((r) => r.soldAfterCountPieces)}::integer[])
             as v(id, sold_since, sold_after)
      where l.tenant_id = ${tenantId} and l.id = v.id`.execute(trx);
  }

  /** The batch of a found product takes the values of its line again (a repost). */
  async refreshSurplusBatch(
    trx: TenantTransaction,
    tenantId: string,
    batchId: string,
    values: {
      lotNumber: string | null;
      expiryDate: string;
      purchasePricePerPackDirams: number;
      costPerPieceDirams: number;
    },
  ): Promise<void> {
    await trx
      .updateTable('batches')
      .set({
        lotNumber: values.lotNumber,
        expiryDate: values.expiryDate,
        purchasePricePerPackDirams: BigInt(values.purchasePricePerPackDirams),
        costPerPieceDirams: BigInt(values.costPerPieceDirams),
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', batchId)
      .where('origin', '=', 'inventory_surplus')
      .execute();
  }

  /** false when the id (the idempotency key) is already taken. */
  async insertEntry(
    trx: TenantTransaction,
    tenantId: string,
    entry: {
      id: string;
      documentId: string;
      lineId: string;
      qtyPieces: number;
      enteredBy: string;
    },
  ): Promise<boolean> {
    const result = await sql<{ id: string }>`
      insert into pharmacy.inventory_count_entries
        (tenant_id, id, document_id, line_id, qty_pieces, entered_by)
      values (${tenantId}, ${entry.id}, ${entry.documentId}, ${entry.lineId},
              ${entry.qtyPieces}, ${entry.enteredBy})
      on conflict (tenant_id, id) do nothing
      returning id`.execute(trx);
    return result.rows.length > 0;
  }

  async findEntry(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<Omit<CountEntryRow, 'enteredByName'> | null> {
    const row = await trx
      .selectFrom('inventoryCountEntries')
      .select([
        'id',
        'documentId',
        'lineId',
        'qtyPieces',
        'enteredBy',
        'enteredAt',
      ])
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return (row as Omit<CountEntryRow, 'enteredByName'> | undefined) ?? null;
  }

  async deleteEntry(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<void> {
    await trx
      .deleteFrom('inventoryCountEntries')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async entriesOfLine(
    trx: TenantTransaction,
    tenantId: string,
    lineId: string,
  ): Promise<number> {
    const row = await trx
      .selectFrom('inventoryCountEntries')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('tenantId', '=', tenantId)
      .where('lineId', '=', lineId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async insertFoundLine(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    line: FoundLineValues,
  ): Promise<string> {
    const id = newId();
    await sql`
      insert into pharmacy.inventory_lines
        (tenant_id, id, document_id, line_no, product_id, batch_id, is_found, book_qty_pieces,
         surplus_lot_number, surplus_expiry_date, surplus_purchase_price_per_pack_dirams)
      values (${tenantId}, ${id}, ${documentId},
              (select coalesce(max(line_no), 0) + 1 from pharmacy.inventory_lines
                where tenant_id = ${tenantId} and document_id = ${documentId}),
              ${line.productId}, null, true, 0, ${line.lotNumber}, ${line.expiryDate}::date,
              ${line.purchasePricePerPackDirams == null ? null : BigInt(line.purchasePricePerPackDirams)})`.execute(
      trx,
    );
    return id;
  }

  async updateFoundLine(
    trx: TenantTransaction,
    tenantId: string,
    lineId: string,
    line: Omit<FoundLineValues, 'productId'>,
  ): Promise<void> {
    await trx
      .updateTable('inventoryLines')
      .set({
        surplusLotNumber: line.lotNumber,
        surplusExpiryDate: line.expiryDate,
        ...(line.purchasePricePerPackDirams === undefined
          ? {}
          : {
              surplusPurchasePricePerPackDirams:
                line.purchasePricePerPackDirams === null
                  ? null
                  : BigInt(line.purchasePricePerPackDirams),
            }),
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', lineId)
      .execute();
  }

  async deleteLine(
    trx: TenantTransaction,
    tenantId: string,
    lineId: string,
  ): Promise<void> {
    await trx
      .deleteFrom('inventoryLines')
      .where('tenantId', '=', tenantId)
      .where('id', '=', lineId)
      .execute();
  }

  async setComment(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    comment: string | null,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({ comment, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', documentId)
      .execute();
  }

  async markCancelled(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    employeeId: string,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        status: 'cancelled',
        cancelledBy: employeeId,
        cancelledAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', documentId)
      .execute();
  }

  /** The running count of a store, if any. */
  async running(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<string | null> {
    const row = await trx
      .selectFrom('documents')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('type', '=', 'inventory')
      .where('status', '=', 'draft')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  /**
   * Surplus and shortage lines and the difference at cost of the counts: posted — by the fixed
   * counts, running — by the entries against the stock of the batches at the first entry (K2).
   */
  async summaries(
    trx: TenantTransaction,
    tenantId: string,
    documentIds: readonly string[],
  ): Promise<Map<string, CountSummaryRow>> {
    if (documentIds.length === 0) return new Map();
    const result = await sql<CountSummaryRow>`
      with diffs as (
        select l.document_id,
               case when d.status = 'posted'
                    then l.counted_qty_pieces - case when l.is_found then 0
                                                     else l.book_qty_pieces - l.sold_since_start_pieces end
                    else e.fact - coalesce(s.qty, 0) end as diff,
               coalesce(b.cost_per_piece_dirams,
                        ceil(l.surplus_purchase_price_per_pack_dirams::numeric / p.pieces_per_pack))
                 as piece_cost
        from pharmacy.inventory_lines l
        join pharmacy.documents d on d.tenant_id = l.tenant_id and d.id = l.document_id
        join pharmacy.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
        left join pharmacy.batches b
          on b.tenant_id = l.tenant_id and b.id = coalesce(l.batch_id, l.surplus_batch_id)
        -- a posted count reads its fixed numbers: no entries or stock lookups for it
        left join lateral (
          select sum(x.qty_pieces) as fact, min(x.entered_at) as at
          from pharmacy.inventory_count_entries x
          where x.tenant_id = l.tenant_id and x.line_id = l.id and d.status <> 'posted'
        ) e on true
        left join lateral (${stockAt(sql`l`, sql`d.store_id`, sql`e.at`)}) s on true
        where l.tenant_id = ${tenantId} and l.document_id in (${sql.join([...documentIds])})
      )
      select document_id,
             count(*) filter (where diff > 0)::integer as surplus_lines,
             count(*) filter (where diff < 0)::integer as shortage_lines,
             coalesce(sum(diff * coalesce(piece_cost, 0)), 0)::bigint as diff_dirams
      from diffs where diff is not null
      group by document_id`.execute(trx);
    return new Map(result.rows.map((r) => [r.documentId, r]));
  }
}
