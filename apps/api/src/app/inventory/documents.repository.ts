import { Injectable } from '@nestjs/common';
import { type RawBuilder, sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';

export type StockDocumentType = 'goods_receipt' | 'opening_balance';

// The line table of each document type (constants: never user input).
const LINES: Record<StockDocumentType, RawBuilder<unknown>> = {
  goods_receipt: sql.raw('pharmacy.goods_receipt_lines'),
  opening_balance: sql.raw('pharmacy.opening_balance_lines'),
};

export interface DocumentRow {
  id: string;
  storeId: string;
  type: StockDocumentType;
  number: string;
  documentDate: string;
  status: 'draft' | 'posted';
  createdBy: string;
  createdAt: Date;
  postedBy: string | null;
  postedAt: Date | null;
  comment: string | null;
  totalDirams: bigint | null;
  supplierId: string | null;
  supplierInvoiceNumber: string | null;
  paymentDueDate: string | null;
}

export interface LineRow {
  id: string;
  lineNo: number;
  productId: string;
  qtyPieces: number;
  expiryDate: string;
  lotNumber: string | null;
  purchasePricePerPackDirams: bigint;
  retailPriceDraftDirams: bigint | null;
  batchId: string | null;
  /** Opening balances only; false for a goods receipt. */
  isStarting: boolean;
}

export interface LineValues {
  productId: string;
  qtyPieces: number;
  expiryDate: string;
  lotNumber: string | null;
  purchasePricePerPackDirams: number;
  retailPriceDraftDirams: number | null;
  batchId: string | null;
  isStarting: boolean;
}

export interface HeaderValues {
  storeId: string;
  documentDate: string;
  comment: string | null;
  totalDirams: number;
  supplierId: string | null;
  supplierInvoiceNumber: string | null;
  paymentDueDate: string | null;
}

export interface MovementRow {
  id: string;
  recordedAt: Date;
  batchId: string;
  storeId: string;
  qtyDeltaPieces: number;
  kind: string;
  sourceLineId: string | null;
  reversesMovementId: string | null;
}

export interface ForeignMovementRow {
  batchId: string;
  kind: string;
  qtyDeltaPieces: number;
  sourceId: string;
  sourceNumber: string | null;
}

const HEADER = sql`d.id, d.store_id, d.type, d.number, d.document_date::text as document_date,
  d.status, d.created_by, d.created_at, d.posted_by, d.posted_at, d.comment, d.total_dirams,
  d.supplier_id, d.supplier_invoice_number, d.payment_due_date::text as payment_due_date`;

// Stock documents, their lines, batches and movements (data model 03). The header and its lines
// are one aggregate; movements are append-only.
@Injectable()
export class DocumentsRepository {
  async insertDocument(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    type: StockDocumentType,
    number: string,
    createdBy: string,
    header: HeaderValues,
  ): Promise<void> {
    await trx
      .insertInto('documents')
      .values({
        tenantId,
        id,
        type,
        number,
        createdBy,
        ...header,
        totalDirams: BigInt(header.totalDirams),
      })
      .execute();
  }

  async updateHeader(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    header: HeaderValues,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        ...header,
        totalDirams: BigInt(header.totalDirams),
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async findDocument(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    id: string,
    lock = false,
  ): Promise<DocumentRow | null> {
    const result = await sql<DocumentRow>`
      select ${HEADER} from pharmacy.documents d
      where d.tenant_id = ${tenantId} and d.id = ${id} and d.type = ${type}
      ${lock ? sql`for update` : sql``}`.execute(trx);
    return result.rows[0] ?? null;
  }

  async listDocuments(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    filter: {
      storeIds: readonly string[] | null;
      status?: string;
      supplierId?: string;
    },
    page: { limit: number; offset: number },
  ): Promise<{
    rows: Array<DocumentRow & { positions: number }>;
    total: number;
  }> {
    if (filter.storeIds !== null && filter.storeIds.length === 0) {
      return { rows: [], total: 0 };
    }
    const result = await sql<
      DocumentRow & { positions: number; total: bigint }
    >`
      select ${HEADER},
             (select count(*)::integer from ${LINES[type]} l
               where l.tenant_id = d.tenant_id and l.document_id = d.id) as positions,
             count(*) over () as total
      from pharmacy.documents d
      where d.tenant_id = ${tenantId} and d.type = ${type}
        ${filter.storeIds === null ? sql`` : sql`and d.store_id in (${sql.join([...filter.storeIds])})`}
        ${filter.status ? sql`and d.status = ${filter.status}` : sql``}
        ${filter.supplierId ? sql`and d.supplier_id = ${filter.supplierId}` : sql``}
      order by d.document_date desc, d.number desc
      limit ${page.limit} offset ${page.offset}`.execute(trx);
    return {
      rows: result.rows,
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  /** Posted documents of the month of `today` and drafts, in the stores. */
  async kpi(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    storeIds: readonly string[] | null,
    today: string,
  ): Promise<{
    postedThisMonth: number;
    postedThisMonthDirams: bigint;
    drafts: number;
  }> {
    if (storeIds !== null && storeIds.length === 0) {
      return { postedThisMonth: 0, postedThisMonthDirams: 0n, drafts: 0 };
    }
    const result = await sql<{
      postedThisMonth: number;
      postedThisMonthDirams: bigint;
      drafts: number;
    }>`
      select count(*) filter (where status = 'posted'
               and date_trunc('month', document_date) = date_trunc('month', ${today}::date))::integer
               as posted_this_month,
             coalesce(sum(total_dirams) filter (where status = 'posted'
               and date_trunc('month', document_date) = date_trunc('month', ${today}::date)), 0)::bigint
               as posted_this_month_dirams,
             count(*) filter (where status = 'draft')::integer as drafts
      from pharmacy.documents
      where tenant_id = ${tenantId} and type = ${type}
        ${storeIds === null ? sql`` : sql`and store_id in (${sql.join([...storeIds])})`}`.execute(
      trx,
    );
    return result.rows[0];
  }

  async lines(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    documentId: string,
  ): Promise<LineRow[]> {
    const result = await sql<LineRow>`
      select id, line_no, product_id, qty_pieces, expiry_date::text as expiry_date, lot_number,
             purchase_price_per_pack_dirams, retail_price_draft_dirams, batch_id,
             ${type === 'opening_balance' ? sql`is_starting` : sql`false`} as is_starting
      from ${LINES[type]}
      where tenant_id = ${tenantId} and document_id = ${documentId}
      order by line_no`.execute(trx);
    return result.rows;
  }

  /** The lines of the document become exactly `lines`, numbered in order. */
  async replaceLines(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    documentId: string,
    lines: readonly LineValues[],
  ): Promise<void> {
    await sql`delete from ${LINES[type]}
      where tenant_id = ${tenantId} and document_id = ${documentId}`.execute(
      trx,
    );
    for (const [index, line] of lines.entries()) {
      const common = sql`${tenantId}, ${newId()}, ${documentId}, ${index + 1}, ${line.productId},
        ${line.qtyPieces}, ${line.expiryDate}::date, ${line.lotNumber},
        ${BigInt(line.purchasePricePerPackDirams)},
        ${line.retailPriceDraftDirams === null ? null : BigInt(line.retailPriceDraftDirams)},
        ${line.batchId}`;
      await (
        type === 'opening_balance'
          ? sql`insert into pharmacy.opening_balance_lines
            (tenant_id, id, document_id, line_no, product_id, qty_pieces, expiry_date, lot_number,
             purchase_price_per_pack_dirams, retail_price_draft_dirams, batch_id, is_starting)
            values (${common}, ${line.isStarting})`
          : sql`insert into pharmacy.goods_receipt_lines
            (tenant_id, id, document_id, line_no, product_id, qty_pieces, expiry_date, lot_number,
             purchase_price_per_pack_dirams, retail_price_draft_dirams, batch_id)
            values (${common})`
      ).execute(trx);
    }
  }

  async setLineBatch(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    lineId: string,
    batchId: string,
  ): Promise<void> {
    await sql`update ${LINES[type]} set batch_id = ${batchId}
      where tenant_id = ${tenantId} and id = ${lineId}`.execute(trx);
  }

  async insertBatch(
    trx: TenantTransaction,
    tenantId: string,
    batch: {
      id: string;
      storeId: string;
      productId: string;
      expiryDate: string;
      lotNumber: string | null;
      purchasePricePerPackDirams: number;
      costPerPieceDirams: number;
      supplierId: string | null;
      origin: StockDocumentType;
      sourceDocumentId: string;
      isStarting: boolean;
    },
  ): Promise<void> {
    await trx
      .insertInto('batches')
      .values({
        tenantId,
        ...batch,
        purchasePricePerPackDirams: BigInt(batch.purchasePricePerPackDirams),
        costPerPieceDirams: BigInt(batch.costPerPieceDirams),
      })
      .execute();
  }

  async insertMovements(
    trx: TenantTransaction,
    tenantId: string,
    movements: ReadonlyArray<{
      storeId: string;
      batchId: string;
      qtyDeltaPieces: number;
      kind: string;
      sourceId: string;
      sourceLineId: string | null;
      businessDate: string;
      reversesMovementId: string | null;
    }>,
  ): Promise<void> {
    if (movements.length === 0) return;
    await trx
      .insertInto('stockMovements')
      .values(
        movements.map((m) => ({
          tenantId,
          id: newId(),
          sourceType: 'document',
          ...m,
        })),
      )
      .execute();
  }

  /** Movements written by this document, oldest first. */
  async documentMovements(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<MovementRow[]> {
    return trx
      .selectFrom('stockMovements')
      .select([
        'id',
        'recordedAt',
        'batchId',
        'storeId',
        'qtyDeltaPieces',
        'kind',
        'sourceLineId',
        'reversesMovementId',
      ])
      .where('tenantId', '=', tenantId)
      .where('sourceId', '=', documentId)
      .orderBy('recordedAt')
      .orderBy('id')
      .execute() as Promise<MovementRow[]>;
  }

  /** Locks the batches for the stock checks that follow (ADR-0006: lock, then count). */
  async lockBatches(
    trx: TenantTransaction,
    tenantId: string,
    batchIds: readonly string[],
  ): Promise<void> {
    if (batchIds.length === 0) return;
    await sql`select id from pharmacy.batches
      where tenant_id = ${tenantId} and id in (${sql.join([...batchIds])})
      order by id for update`.execute(trx);
  }

  /** Movements of the batches written by anything but this document. */
  async foreignMovements(
    trx: TenantTransaction,
    tenantId: string,
    batchIds: readonly string[],
    documentId: string,
  ): Promise<ForeignMovementRow[]> {
    if (batchIds.length === 0) return [];
    const result = await sql<ForeignMovementRow>`
      select m.batch_id, m.kind, m.qty_delta_pieces, m.source_id, d.number as source_number
      from pharmacy.stock_movements m
      left join pharmacy.documents d on d.tenant_id = m.tenant_id and d.id = m.source_id
      where m.tenant_id = ${tenantId} and m.batch_id in (${sql.join([...batchIds])})
        and m.source_id <> ${documentId}`.execute(trx);
    return result.rows;
  }

  async markPosted(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    postedBy: string,
    totalDirams: number,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        status: 'posted',
        postedBy,
        postedAt: sql`now()`,
        totalDirams: BigInt(totalDirams),
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async markUnposted(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    unpostedBy: string,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        status: 'draft',
        postedBy: null,
        postedAt: null,
        unpostedBy,
        unpostedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }
}
