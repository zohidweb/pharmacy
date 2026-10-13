import { Injectable } from '@nestjs/common';
import { type RawBuilder, sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';
import { type DocumentRow, HEADER } from './documents.repository';

export interface RequestLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  productId: string;
  qtyRequestedPieces: number;
  piecesPerPack: number;
}

export interface TransferLineRow {
  id: string;
  lineNo: number;
  sourceBatchId: string;
  productId: string;
  unit: 'pack' | 'piece';
  qtySentPieces: number;
  qtyReceivedPieces: number | null;
  targetBatchId: string | null;
  /** The batch of the sender. */
  batchStoreId: string;
  lotNumber: string | null;
  expiryDate: string;
  purchasePricePerPackDirams: bigint;
  costPerPieceDirams: bigint;
  supplierId: string | null;
  piecesPerPack: number;
}

/** A request or a transfer of the overview, with what its list needs. */
export type OverviewRow = DocumentRow & {
  positions: number;
  /** A transfer accepted with a shortage: the write-off of it. */
  writeOffId: string | null;
};

/** Either side of a request or a transfer is one of the stores (null — every store). */
const ofStores = (storeIds: readonly string[] | null) =>
  storeIds === null
    ? sql``
    : sql`and (d.store_id in (${sql.join([...storeIds])})
           or d.destination_store_id in (${sql.join([...storeIds])}))`;

// The lines of transfer requests and transfers (spec 2026-10-12-supplier-returns-transfers, 3.2);
// the headers live in DocumentsRepository.
@Injectable()
export class TransfersRepository {
  async replaceRequestLines(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    lines: ReadonlyArray<{ productId: string; qtyRequestedPieces: number }>,
  ): Promise<void> {
    await trx
      .deleteFrom('transferRequestLines')
      .where('tenantId', '=', tenantId)
      .where('documentId', '=', documentId)
      .execute();
    if (lines.length === 0) return;
    await trx
      .insertInto('transferRequestLines')
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

  /** The lines of the requests, by request. */
  async requestLines(
    trx: TenantTransaction,
    tenantId: string,
    documentIds: readonly string[],
  ): Promise<Map<string, RequestLineRow[]>> {
    const map = new Map<string, RequestLineRow[]>();
    if (documentIds.length === 0) return map;
    const result = await sql<RequestLineRow>`
      select l.id, l.document_id, l.line_no, l.product_id, l.qty_requested_pieces,
             p.pieces_per_pack
      from pharmacy.transfer_request_lines l
      join pharmacy.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
      where l.tenant_id = ${tenantId} and l.document_id in (${sql.join([...documentIds])})
      order by l.document_id, l.line_no`.execute(trx);
    for (const row of result.rows) {
      map.set(row.documentId, [...(map.get(row.documentId) ?? []), row]);
    }
    return map;
  }

  async replaceTransferLines(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
    lines: ReadonlyArray<{
      sourceBatchId: string;
      productId: string;
      unit: 'pack' | 'piece';
      qtySentPieces: number;
    }>,
  ): Promise<void> {
    await trx
      .deleteFrom('transferLines')
      .where('tenantId', '=', tenantId)
      .where('documentId', '=', documentId)
      .execute();
    if (lines.length === 0) return;
    await trx
      .insertInto('transferLines')
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

  async transferLines(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<TransferLineRow[]> {
    const result = await sql<TransferLineRow>`
      select l.id, l.line_no, l.source_batch_id, l.product_id, l.unit, l.qty_sent_pieces,
             l.qty_received_pieces, l.target_batch_id, b.store_id as batch_store_id, b.lot_number,
             b.expiry_date::text as expiry_date, b.purchase_price_per_pack_dirams,
             b.cost_per_piece_dirams, b.supplier_id, p.pieces_per_pack
      from pharmacy.transfer_lines l
      join pharmacy.batches b on b.tenant_id = l.tenant_id and b.id = l.source_batch_id
      join pharmacy.products p on p.tenant_id = l.tenant_id and p.id = l.product_id
      where l.tenant_id = ${tenantId} and l.document_id = ${documentId}
      order by l.line_no`.execute(trx);
    return result.rows;
  }

  async setReceived(
    trx: TenantTransaction,
    tenantId: string,
    lineId: string,
    qtyReceivedPieces: number,
    targetBatchId: string | null,
  ): Promise<void> {
    await trx
      .updateTable('transferLines')
      .set({ qtyReceivedPieces, targetBatchId })
      .where('tenantId', '=', tenantId)
      .where('id', '=', lineId)
      .execute();
  }

  /** The not cancelled transfers of the requests: request → { id, number }. */
  async transfersOfRequests(
    trx: TenantTransaction,
    tenantId: string,
    requestIds: readonly string[],
  ): Promise<Map<string, { id: string; number: string }>> {
    if (requestIds.length === 0) return new Map();
    const rows = await trx
      .selectFrom('documents')
      .select(['id', 'number', 'requestDocumentId'])
      .where('tenantId', '=', tenantId)
      .where('type', '=', 'transfer')
      .where('status', '<>', 'cancelled')
      .where('requestDocumentId', 'in', [...requestIds])
      .execute();
    return new Map(
      rows.map((r) => [
        r.requestDocumentId as string,
        { id: r.id, number: r.number },
      ]),
    );
  }

  /** The write-off of the shortage of a transfer (T6), if any. */
  async writeOffOf(
    trx: TenantTransaction,
    tenantId: string,
    transferId: string,
  ): Promise<{ id: string; number: string } | null> {
    const row = await trx
      .selectFrom('documents')
      .select(['id', 'number'])
      .where('tenantId', '=', tenantId)
      .where('type', '=', 'write_off')
      .where('sourceDocumentId', '=', transferId)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * Requests or transfers of the stores (either side; null — every store), newest first (spec
   * 5.4): every open one, and the closed ones of the business dates from `since`, at most `limit`
   * of them — an open document never drops out of the only screen it is acted on.
   */
  async overview(
    trx: TenantTransaction,
    tenantId: string,
    type: 'transfer' | 'transfer_request',
    storeIds: readonly string[] | null,
    since: string,
    limit: number,
  ): Promise<OverviewRow[]> {
    if (storeIds !== null && storeIds.length === 0) return [];
    const open =
      type === 'transfer'
        ? sql`d.status in ('draft', 'in_transit')`
        : sql`d.status in ('draft', 'sent', 'in_progress')`;
    const lines =
      type === 'transfer'
        ? sql.raw('pharmacy.transfer_lines')
        : sql.raw('pharmacy.transfer_request_lines');
    const query = (
      which: RawBuilder<unknown>,
      tail: RawBuilder<unknown>,
    ) => sql<OverviewRow>`
      select ${HEADER},
             (select count(*)::integer from ${lines} l
               where l.tenant_id = d.tenant_id and l.document_id = d.id) as positions,
             (select w.id from pharmacy.documents w
               where w.tenant_id = d.tenant_id and w.type = 'write_off'
                 and w.source_document_id = d.id limit 1) as write_off_id
      from pharmacy.documents d
      where d.tenant_id = ${tenantId} and d.type = ${type}
        ${ofStores(storeIds)}
        and ${which}
      order by d.document_date desc, d.number desc
      ${tail}`;
    const opened = await query(open, sql``).execute(trx);
    const closed = await query(
      sql`not (${open}) and d.document_date >= ${since}::date`,
      sql`limit ${limit}`,
    ).execute(trx);
    return [...opened.rows, ...closed.rows].sort(
      (a, b) =>
        b.documentDate.localeCompare(a.documentDate) ||
        b.number.localeCompare(a.number),
    );
  }

  /** The counters of the overview over every document of the stores, not over a page of them. */
  async overviewKpi(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[] | null,
  ): Promise<{
    newRequests: number;
    requestsInProgress: number;
    inTransit: number;
  }> {
    if (storeIds !== null && storeIds.length === 0) {
      return { newRequests: 0, requestsInProgress: 0, inTransit: 0 };
    }
    const result = await sql<{
      newRequests: number;
      requestsInProgress: number;
      inTransit: number;
    }>`
      select count(*) filter (where d.type = 'transfer_request' and d.status = 'sent'
               ${storeIds === null ? sql`` : sql`and d.destination_store_id in (${sql.join([...storeIds])})`}
             )::integer as new_requests,
             count(*) filter (where d.type = 'transfer_request' and d.status = 'in_progress')::integer
               as requests_in_progress,
             count(*) filter (where d.type = 'transfer' and d.status = 'in_transit')::integer
               as in_transit
      from pharmacy.documents d
      where d.tenant_id = ${tenantId} and d.type in ('transfer', 'transfer_request')
        and d.status in ('sent', 'in_progress', 'in_transit')
        ${ofStores(storeIds)}`.execute(trx);
    return result.rows[0];
  }
}
