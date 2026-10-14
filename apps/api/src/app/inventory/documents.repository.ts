import { Injectable } from '@nestjs/common';
import { type RawBuilder, sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';

export type StockDocumentType =
  | 'goods_receipt'
  | 'opening_balance'
  | 'write_off'
  | 'inventory'
  | 'supplier_return'
  | 'transfer'
  | 'transfer_request';

/** Statuses of the documents table (a transfer and a request have their own, data model 03). */
export type DocumentStatusValue =
  | 'draft'
  | 'posted'
  | 'cancelled'
  | 'in_transit'
  | 'received'
  | 'sent'
  | 'in_progress'
  | 'partial'
  | 'done'
  | 'rejected';

// The line table of each document type (constants: never user input).
const LINES: Record<StockDocumentType, RawBuilder<unknown>> = {
  goods_receipt: sql.raw('pharmacy.goods_receipt_lines'),
  opening_balance: sql.raw('pharmacy.opening_balance_lines'),
  write_off: sql.raw('pharmacy.write_off_lines'),
  inventory: sql.raw('pharmacy.inventory_lines'),
  supplier_return: sql.raw('pharmacy.supplier_return_lines'),
  transfer: sql.raw('pharmacy.transfer_lines'),
  transfer_request: sql.raw('pharmacy.transfer_request_lines'),
};

export interface DocumentRow {
  id: string;
  storeId: string;
  type: StockDocumentType;
  number: string;
  documentDate: string;
  status: DocumentStatusValue;
  createdBy: string;
  createdAt: Date;
  postedBy: string | null;
  postedAt: Date | null;
  comment: string | null;
  totalDirams: bigint | null;
  supplierId: string | null;
  supplierInvoiceNumber: string | null;
  paymentDueDate: string | null;
  purchaseOrderId: string | null;
  writeOffReason: string | null;
  supplierReturnReason: string | null;
  /** A supplier return → its goods receipt. */
  sourceDocumentId: string | null;
  /** A write-off made by a customer return (spec 2026-10-13-customer-returns, E9). */
  sourceCustomerReturnId: string | null;
  inventoryScope: 'all' | 'category' | null;
  inventoryCategoryId: string | null;
  inventoryStartedAt: Date | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  /** The receiver of a transfer, the store asked by a request. */
  destinationStoreId: string | null;
  /** A transfer → its request. */
  requestDocumentId: string | null;
  dispatchedAt: Date | null;
  dispatchedBy: string | null;
  receivedAt: Date | null;
  receivedBy: string | null;
  receivedComment: string | null;
  rejectionReason: string | null;
  rejectionComment: string | null;
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
  /** Goods receipts by an order only. */
  purchaseOrderLineId: string | null;
  orderPricePerPackDirams: bigint | null;
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
  purchaseOrderLineId: string | null;
  orderPricePerPackDirams: number | null;
}

export interface HeaderValues {
  storeId: string;
  documentDate: string;
  comment: string | null;
  totalDirams: number;
  supplierId: string | null;
  supplierInvoiceNumber: string | null;
  paymentDueDate: string | null;
  purchaseOrderId: string | null;
  writeOffReason?: string | null;
  supplierReturnReason?: string | null;
  sourceDocumentId?: string | null;
  sourceCustomerReturnId?: string | null;
  destinationStoreId?: string | null;
  requestDocumentId?: string | null;
  inventoryScope?: 'all' | 'category' | null;
  inventoryCategoryId?: string | null;
  /** The start of a stock count: the transaction time (`now()`), not the clock of the process. */
  inventoryStartedAt?: Date | RawBuilder<Date> | null;
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

/** The columns of a document header as `DocumentRow` reads them (`d` — pharmacy.documents). */
export const HEADER = sql`d.id, d.store_id, d.type, d.number, d.document_date::text as document_date,
  d.status, d.created_by, d.created_at, d.posted_by, d.posted_at, d.comment, d.total_dirams,
  d.supplier_id, d.supplier_invoice_number, d.payment_due_date::text as payment_due_date,
  d.purchase_order_id, d.write_off_reason, d.supplier_return_reason, d.source_document_id,
  d.source_customer_return_id,
  d.inventory_scope, d.inventory_category_id,
  d.inventory_started_at, d.cancelled_by, d.cancelled_at, d.destination_store_id,
  d.request_document_id, d.dispatched_at, d.dispatched_by, d.received_at, d.received_by,
  d.received_comment, d.rejection_reason, d.rejection_comment`;

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

  /**
   * `lock` takes FOR NO KEY UPDATE: it serialises writes of the document, yet lets a payment add an
   * allocation to it meanwhile (the foreign key check takes FOR KEY SHARE) — FOR UPDATE would
   * deadlock an unposting waiting for the settlement lock that payment holds.
   */
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
      ${lock ? sql`for no key update` : sql``}`.execute(trx);
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
      writeOffReason?: string;
      supplierReturnReason?: string;
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
        ${filter.writeOffReason ? sql`and d.write_off_reason = ${filter.writeOffReason}` : sql``}
        ${filter.supplierReturnReason ? sql`and d.supplier_return_reason = ${filter.supplierReturnReason}` : sql``}
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
               and document_date >= date_trunc('month', ${today}::date)::date
               and document_date < (date_trunc('month', ${today}::date) + interval '1 month')::date)::integer
               as posted_this_month,
             coalesce(sum(total_dirams) filter (where status = 'posted'
               and document_date >= date_trunc('month', ${today}::date)::date
               and document_date < (date_trunc('month', ${today}::date) + interval '1 month')::date), 0)::bigint
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
             ${
               type === 'opening_balance'
                 ? sql`is_starting, null::uuid as purchase_order_line_id,
                       null::bigint as order_price_per_pack_dirams`
                 : sql`false as is_starting, purchase_order_line_id, order_price_per_pack_dirams`
             }
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
             purchase_price_per_pack_dirams, retail_price_draft_dirams, batch_id,
             purchase_order_line_id, order_price_per_pack_dirams)
            values (${common}, ${line.purchaseOrderLineId},
              ${line.orderPricePerPackDirams === null ? null : BigInt(line.orderPricePerPackDirams)})`
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
      origin: StockDocumentType | 'inventory_surplus';
      sourceDocumentId: string;
      isStarting: boolean;
      /** The batch of the sender (`origin = 'transfer'`). */
      sourceBatchId?: string | null;
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
      /**
       * `receipt` — a sale of the POS (spec 2026-10-13-pos-shift-sale), `customer_return` — a customer
       * return (spec 2026-10-13-customer-returns); a document by default.
       */
      sourceType?: 'document' | 'receipt' | 'customer_return';
    }>,
  ): Promise<void> {
    // ≤ 1 000 rows per statement: PostgreSQL takes at most 65 535 bind parameters
    for (let from = 0; from < movements.length; from += 1_000) {
      await this.insertMovementRows(
        trx,
        tenantId,
        movements.slice(from, from + 1_000),
      );
    }
  }

  private async insertMovementRows(
    trx: TenantTransaction,
    tenantId: string,
    movements: Parameters<DocumentsRepository['insertMovements']>[2],
  ): Promise<void> {
    if (movements.length === 0) return;
    await trx
      .insertInto('stockMovements')
      .values(
        movements.map((m) => ({
          tenantId,
          id: newId(),
          sourceType: 'document',
          // the moment of the write, not the start of the transaction: a posting that waited for a
          // batch lock must land after the unposting check of a document posted meanwhile (B2)
          recordedAt: sql`clock_timestamp()`,
          ...m,
        })),
      )
      .execute();
  }

  /** Reverses the movements of the document not reversed yet: `reversal` with the opposite sign. */
  async reverseMovements(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    businessDate: string,
  ): Promise<void> {
    const movements = await this.documentMovements(trx, tenantId, documentId);
    const reversed = new Set(
      movements.flatMap((m) =>
        m.reversesMovementId ? [m.reversesMovementId] : [],
      ),
    );
    await this.insertMovements(
      trx,
      tenantId,
      movements
        .filter((m) => m.kind !== 'reversal' && !reversed.has(m.id))
        .map((m) => ({
          storeId: m.storeId,
          batchId: m.batchId,
          qtyDeltaPieces: -m.qtyDeltaPieces,
          kind: 'reversal',
          sourceId: documentId,
          sourceLineId: m.sourceLineId,
          businessDate,
          reversesMovementId: m.id,
        })),
    );
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

  /**
   * Key-share locks on the batches in the order of their ids — what the lines of a document take
   * on them through the foreign key anyway, taken first and in one order.
   */
  async keyShareBatches(
    trx: TenantTransaction,
    tenantId: string,
    batchIds: readonly string[],
  ): Promise<void> {
    if (batchIds.length === 0) return;
    await sql`select id from pharmacy.batches
      where tenant_id = ${tenantId} and id in (${sql.join([...batchIds])})
      order by id for key share`.execute(trx);
  }

  /**
   * Movements of the batches written by anything but this document after `after` (its last
   * posting): only they block an unposting (spec 2026-10-12, B2).
   */
  async foreignMovements(
    trx: TenantTransaction,
    tenantId: string,
    batchIds: readonly string[],
    documentId: string,
    after: Date,
  ): Promise<ForeignMovementRow[]> {
    if (batchIds.length === 0) return [];
    const result = await sql<ForeignMovementRow>`
      select m.batch_id, m.kind, m.qty_delta_pieces, m.source_id, d.number as source_number
      from pharmacy.stock_movements m
      left join pharmacy.documents d on d.tenant_id = m.tenant_id and d.id = m.source_id
      where m.tenant_id = ${tenantId} and m.batch_id in (${sql.join([...batchIds])})
        and m.source_id <> ${documentId} and m.recorded_at > ${after}`.execute(
      trx,
    );
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

  /** The status of a request (`sent`, `in_progress`, `done`, `partial`) or of a document. */
  async setStatus(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    status: DocumentStatusValue,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({ status, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  /** A transfer is sent: dated by the day of the dispatch (E4). */
  async markDispatched(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    employeeId: string,
    documentDate: string,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        status: 'in_transit',
        documentDate,
        dispatchedAt: sql`now()`,
        dispatchedBy: employeeId,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  /** A recalled transfer is a draft again. */
  async markRecalled(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        status: 'draft',
        dispatchedAt: null,
        dispatchedBy: null,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async markReceived(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    employeeId: string,
    comment: string | null,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        status: 'received',
        receivedAt: sql`now()`,
        receivedBy: employeeId,
        receivedComment: comment,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async markRejected(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    reason: string,
    comment: string | null,
  ): Promise<void> {
    await trx
      .updateTable('documents')
      .set({
        status: 'rejected',
        rejectionReason: reason,
        rejectionComment: comment,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  /** A transfer draft is dropped (E3): final, no movements. */
  async markCancelled(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
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
      .where('id', '=', id)
      .execute();
  }

  /** A document nothing refers to (a request draft, E3): its lines, then the header. */
  async deleteDocument(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    id: string,
  ): Promise<void> {
    await sql`delete from ${LINES[type]} where tenant_id = ${tenantId} and document_id = ${id}`.execute(
      trx,
    );
    await trx
      .deleteFrom('documents')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }
}
