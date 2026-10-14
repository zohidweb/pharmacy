import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';

export interface SupplierReturnLineValues {
  batchId: string;
  productId: string;
  qtyPieces: number;
  unit: 'pack' | 'piece';
  note: string | null;
}

export interface SupplierReturnLineRow {
  id: string;
  lineNo: number;
  batchId: string;
  productId: string;
  qtyPieces: number;
  unit: 'pack' | 'piece';
  note: string | null;
  amountDirams: bigint | null;
  lotNumber: string | null;
  expiryDate: string;
  purchasePricePerPackDirams: bigint;
  costPerPieceDirams: bigint;
}

export interface ReturnBatch {
  id: string;
  storeId: string;
  productId: string;
  supplierId: string | null;
  purchasePricePerPackDirams: bigint;
  costPerPieceDirams: bigint;
}

/**
 * Amount of a line at the purchase price of its batch (spec 2026-10-12-supplier-returns-transfers,
 * R2): the formula of the amount of a goods receipt — pieces × price of a pack / pieces per pack.
 */
export const returnAmount = (line: {
  qtyPieces: number;
  purchasePricePerPackDirams: bigint;
  piecesPerPack: number;
}): number =>
  Math.round(
    (line.qtyPieces * Number(line.purchasePricePerPackDirams)) /
      line.piecesPerPack,
  );

/**
 * The lines with the pieces per pack of their products. The products are read through the catalog's
 * ProductsReader (module boundary), not joined here.
 */
export function withPiecesPerPack<T extends { productId: string }>(
  lines: readonly T[],
  products: ReadonlyMap<string, { piecesPerPack: number }>,
): Array<T & { piecesPerPack: number }> {
  return lines.map((line) => {
    const product = products.get(line.productId);
    if (!product)
      throw new Error('A product of the return lines is not readable');
    return { ...line, piecesPerPack: product.piecesPerPack };
  });
}

// The lines of supplier returns (spec 2026-10-12-supplier-returns-transfers, section 3.1): a batch
// of the store and of the supplier of the document; the header lives in DocumentsRepository.
@Injectable()
export class SupplierReturnsRepository {
  async batches(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, ReturnBatch>> {
    if (ids.length === 0) return new Map();
    const rows = await trx
      .selectFrom('batches')
      .select([
        'id',
        'storeId',
        'productId',
        'supplierId',
        'purchasePricePerPackDirams',
        'costPerPieceDirams',
      ])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute();
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The lines of the document become exactly `lines`, numbered in order. */
  async replaceLines(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    lines: readonly SupplierReturnLineValues[],
  ): Promise<void> {
    await trx
      .deleteFrom('supplierReturnLines')
      .where('tenantId', '=', tenantId)
      .where('documentId', '=', documentId)
      .execute();
    if (lines.length === 0) return;
    await trx
      .insertInto('supplierReturnLines')
      .values(
        lines.map((line, index) => ({
          tenantId,
          id: newId(),
          documentId,
          lineNo: index + 1,
          ...line,
        })),
      )
      .execute();
  }

  async lines(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<SupplierReturnLineRow[]> {
    const result = await sql<SupplierReturnLineRow>`
      select l.id, l.line_no, l.batch_id, l.product_id, l.qty_pieces, l.unit, l.note,
             l.amount_dirams, b.lot_number, b.expiry_date::text as expiry_date,
             b.purchase_price_per_pack_dirams, b.cost_per_piece_dirams
      from pharmacy.supplier_return_lines l
      join pharmacy.batches b on b.tenant_id = l.tenant_id and b.id = l.batch_id
      where l.tenant_id = ${tenantId} and l.document_id = ${documentId}
      order by l.line_no`.execute(trx);
    return result.rows;
  }

  /** Fixes the amounts of the lines at posting (amendment 2.1 p. 2), one statement for all. */
  async setAmounts(
    trx: TenantTransaction,
    tenantId: string,
    amounts: ReadonlyArray<{ id: string; amountDirams: number }>,
  ): Promise<void> {
    if (amounts.length === 0) return;
    await sql`
      update pharmacy.supplier_return_lines l
      set amount_dirams = v.amount
      from unnest(${amounts.map((a) => a.id)}::uuid[],
                  ${amounts.map((a) => String(a.amountDirams))}::bigint[]) as v(id, amount)
      where l.tenant_id = ${tenantId} and l.id = v.id`.execute(trx);
  }

  /** A draft has no line amounts (amendment 2.1 p. 2): cleared when the posting is undone. */
  async clearAmounts(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<void> {
    await trx
      .updateTable('supplierReturnLines')
      .set({ amountDirams: null })
      .where('tenantId', '=', tenantId)
      .where('documentId', '=', documentId)
      .execute();
  }

  /** Posted returns of the month of `today` in the stores: count and amount. */
  async kpi(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[] | null,
    today: string,
  ): Promise<{ documents: number; amountDirams: bigint }> {
    if (storeIds !== null && storeIds.length === 0) {
      return { documents: 0, amountDirams: 0n };
    }
    const result = await sql<{ documents: number; amountDirams: bigint }>`
      select count(*)::integer as documents,
             coalesce(sum(total_dirams), 0)::bigint as amount_dirams
      from pharmacy.documents
      where tenant_id = ${tenantId} and type = 'supplier_return' and status = 'posted'
        and document_date >= date_trunc('month', ${today}::date)::date
        and document_date < (date_trunc('month', ${today}::date) + interval '1 month')::date
        ${storeIds === null ? sql`` : sql`and store_id in (${sql.join([...storeIds])})`}`.execute(
      trx,
    );
    return result.rows[0];
  }

  /** Numbers of documents by id (the goods receipts of returns). */
  async numbers(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await trx
      .selectFrom('documents')
      .select(['id', 'number'])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute();
    return new Map(rows.map((r) => [r.id, r.number]));
  }

  /**
   * The goods receipt each batch came from: a batch of a transfer leads to the batch of the sender
   * (`source_batch_id`), the root of the chain is a `goods_receipt` batch (its source document);
   * null for a root of another origin (opening balance, stock count surplus).
   */
  async receiptsOfBatches(
    trx: TenantTransaction,
    tenantId: string,
    batchIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (batchIds.length === 0) return new Map();
    const result = await sql<{
      startId: string;
      origin: string;
      sourceDocumentId: string;
    }>`
      with recursive chain as (
        select b.id as start_id, b.origin, b.source_document_id, b.source_batch_id, 0 as depth
        from pharmacy.batches b
        where b.tenant_id = ${tenantId} and b.id in (${sql.join([...batchIds])})
        union all
        select c.start_id, p.origin, p.source_document_id, p.source_batch_id, c.depth + 1
        from chain c
        join pharmacy.batches p on p.tenant_id = ${tenantId} and p.id = c.source_batch_id
        where c.depth < 100
      )
      select start_id, origin, source_document_id from chain
      where source_batch_id is null`.execute(trx);
    return new Map(
      result.rows.map((r) => [
        r.startId,
        r.origin === 'goods_receipt' ? r.sourceDocumentId : null,
      ]),
    );
  }
}
