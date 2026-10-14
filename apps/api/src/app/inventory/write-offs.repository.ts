import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';

export interface WriteOffLineValues {
  batchId: string;
  productId: string;
  qtyPieces: number;
  unit: 'pack' | 'piece';
}

export interface WriteOffLineRow {
  id: string;
  lineNo: number;
  batchId: string;
  productId: string;
  qtyPieces: number;
  unit: 'pack' | 'piece';
  batchStoreId: string;
  lotNumber: string | null;
  expiryDate: string;
  costPerPieceDirams: bigint;
}

export interface BatchOfStore {
  id: string;
  storeId: string;
  productId: string;
  costPerPieceDirams: bigint;
}

// The lines of write-offs (spec 2026-10-12-write-offs-stock-counts, section 3.1): a batch of the
// store of the document; the header lives in DocumentsRepository.
@Injectable()
export class WriteOffsRepository {
  async batches(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, BatchOfStore>> {
    if (ids.length === 0) return new Map();
    const rows = await trx
      .selectFrom('batches')
      .select(['id', 'storeId', 'productId', 'costPerPieceDirams'])
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
    lines: readonly WriteOffLineValues[],
  ): Promise<void> {
    await trx
      .deleteFrom('writeOffLines')
      .where('tenantId', '=', tenantId)
      .where('documentId', '=', documentId)
      .execute();
    if (lines.length === 0) return;
    await trx
      .insertInto('writeOffLines')
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
  ): Promise<WriteOffLineRow[]> {
    const result = await sql<WriteOffLineRow>`
      select l.id, l.line_no, l.batch_id, l.product_id, l.qty_pieces, l.unit,
             b.store_id as batch_store_id, b.lot_number, b.expiry_date::text as expiry_date,
             b.cost_per_piece_dirams
      from pharmacy.write_off_lines l
      join pharmacy.batches b on b.tenant_id = l.tenant_id and b.id = l.batch_id
      where l.tenant_id = ${tenantId} and l.document_id = ${documentId}
      order by l.line_no`.execute(trx);
    return result.rows;
  }

  /** Posted write-offs of the month of `today` in the stores: count and amount. */
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
      where tenant_id = ${tenantId} and type = 'write_off' and status = 'posted'
        and document_date >= date_trunc('month', ${today}::date)::date
        and document_date < (date_trunc('month', ${today}::date) + interval '1 month')::date
        ${storeIds === null ? sql`` : sql`and store_id in (${sql.join([...storeIds])})`}`.execute(
      trx,
    );
    return result.rows[0];
  }
}
