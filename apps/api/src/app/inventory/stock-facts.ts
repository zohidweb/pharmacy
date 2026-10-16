import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  SyncMovementRow,
  SyncWriteOffDocument,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { SyncApplyError } from '../../core/sync';

export interface StoreBatch {
  productId: string;
  costPerPieceDirams: bigint;
}

export interface StockSummary {
  batches: number;
  totalPieces: number;
  hash: string;
}

// The stock side of the facts of an offline store (ADR-0014 §4; spec 2026-10-16-offline-sync, E3): movements go in
// with the ids of the store and the time of the cloud, without FEFO and without a stock check — the stock of the
// store in the cloud is the sum of its movements. The batches of the store come from its own facts.
@Injectable()
export class StockFacts {
  /** The batches of the store among `ids`; a missing one is a fact of the store not arrived yet. */
  async batchesOf(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    ids: readonly string[],
  ): Promise<Map<string, StoreBatch>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await trx
      .selectFrom('batches')
      .select(['id', 'productId', 'costPerPieceDirams'])
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('id', 'in', unique)
      .execute();
    const found = new Map(rows.map((row) => [row.id, row]));
    if (unique.some((id) => !found.has(id))) {
      throw new SyncApplyError('batch', 'dependency');
    }
    return new Map(
      rows.map((row) => [
        row.id,
        {
          productId: row.productId,
          costPerPieceDirams: BigInt(row.costPerPieceDirams),
        },
      ]),
    );
  }

  /** Movements of the store as it wrote them; the kind and the source are checked by the caller. */
  async insertMovements(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    rows: readonly SyncMovementRow[],
  ): Promise<void> {
    for (const row of rows) {
      if (row.storeId !== storeId) throw new SyncApplyError('store_mismatch');
      if (
        !Number.isSafeInteger(row.qtyDeltaPieces) ||
        row.qtyDeltaPieces === 0
      ) {
        throw new SyncApplyError('movement_mismatch');
      }
    }
    // ≤ 1 000 rows per statement: PostgreSQL takes at most 65 535 bind parameters
    for (let from = 0; from < rows.length; from += 1_000) {
      await trx
        .insertInto('stockMovements')
        .values(
          rows.slice(from, from + 1_000).map((row) => ({
            tenantId,
            id: row.id,
            recordedAt: sql<Date>`clock_timestamp()`,
            storeId: row.storeId,
            batchId: row.batchId,
            qtyDeltaPieces: row.qtyDeltaPieces,
            kind: row.kind,
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            sourceLineId: row.sourceLineId,
            businessDate: row.businessDate,
            reversesMovementId: row.reversesMovementId,
          })),
        )
        .execute();
    }
  }

  /**
   * A posted write-off of the store made inside another fact (the automatic write-off of a customer return,
   * spec 2026-10-13-customer-returns, E9): the document, its lines and their movements, the total as the store
   * computes it (pieces × cost of a piece of the batch).
   */
  async applyWriteOff(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    writeOff: SyncWriteOffDocument,
    sourceCustomerReturnId: string | null,
  ): Promise<void> {
    const { document, lines, movements } = writeOff;
    if (document.storeId !== storeId)
      throw new SyncApplyError('store_mismatch');
    if (
      document.type !== 'write_off' ||
      document.status !== 'posted' ||
      document.sourceCustomerReturnId !== sourceCustomerReturnId ||
      lines.length === 0 ||
      lines.some(
        (line) => line.documentId !== document.id || !(line.qtyPieces > 0),
      )
    ) {
      throw new SyncApplyError('write_off_mismatch');
    }
    const batches = await this.batchesOf(
      trx,
      tenantId,
      storeId,
      lines.map((line) => line.batchId),
    );
    if (
      lines.some(
        (line) => batches.get(line.batchId)?.productId !== line.productId,
      )
    ) {
      throw new SyncApplyError('batch_mismatch');
    }
    // one movement per line: −pieces, kind write_off, source = the document and its line
    const byLine = new Map(lines.map((line) => [line.id, line]));
    if (
      movements.length !== lines.length ||
      movements.some((m) => {
        const line = m.sourceLineId ? byLine.get(m.sourceLineId) : undefined;
        return (
          !line ||
          m.kind !== 'write_off' ||
          m.sourceType !== 'document' ||
          m.sourceId !== document.id ||
          m.batchId !== line.batchId ||
          m.qtyDeltaPieces !== -line.qtyPieces
        );
      })
    ) {
      throw new SyncApplyError('movement_mismatch');
    }
    const total = lines.reduce(
      (sum, line) =>
        sum +
        BigInt(line.qtyPieces) *
          (batches.get(line.batchId)?.costPerPieceDirams ?? 0n),
      0n,
    );
    await trx
      .insertInto('documents')
      .values({
        tenantId,
        id: document.id,
        storeId,
        type: 'write_off',
        number: document.number,
        documentDate: document.documentDate,
        status: 'posted',
        comment: document.comment,
        createdBy: document.createdBy,
        postedAt: document.postedAt,
        postedBy: document.postedBy,
        writeOffReason: document.writeOffReason,
        sourceCustomerReturnId,
        totalDirams: total,
      })
      .execute();
    await trx
      .insertInto('writeOffLines')
      .values(
        lines.map((line) => ({
          tenantId,
          id: line.id,
          documentId: document.id,
          lineNo: line.lineNo,
          productId: line.productId,
          batchId: line.batchId,
          qtyPieces: line.qtyPieces,
          unit: line.unit,
        })),
      )
      .execute();
    await this.insertMovements(trx, tenantId, storeId, movements);
  }

  /**
   * The stock of the store in the cloud for the checkpoint (spec E19): batches with a non-zero stock, their
   * total and SHA-256 hex of `${batchId}:${onHand}\n` sorted by batch id.
   */
  async summary(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<StockSummary> {
    const { rows } = await sql<{ batchId: string; onHand: number }>`
      select m.batch_id, sum(m.qty_delta_pieces)::integer as on_hand
      from pharmacy.stock_movements m
      where m.tenant_id = ${tenantId} and m.store_id = ${storeId}
      group by m.batch_id
      having sum(m.qty_delta_pieces) <> 0`.execute(trx);
    const sorted = [...rows].sort((a, b) =>
      a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0,
    );
    const hash = createHash('sha256')
      .update(sorted.map((row) => `${row.batchId}:${row.onHand}\n`).join(''))
      .digest('hex');
    return {
      batches: sorted.length,
      totalPieces: sorted.reduce((sum, row) => sum + row.onHand, 0),
      hash,
    };
  }
}
