import { Injectable } from '@nestjs/common';
import type {
  SyncAuditRow,
  SyncOperationType,
  TransferDispatchedPayload,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  requireEmployees,
  sameStore,
  storeTime,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import { StockFacts } from './stock-facts';
import { TransferPosting } from './transfer-posting';

// The transfers of offline stores applied in the cloud (ADR-0014 §4; spec 2026-10-16-offline-sync, E34, E37): the
// dispatch of an offline sender and the acceptance of an offline receiver go in with the ids of the store. The cloud
// never writes the stock of an offline store: its dispatch, its acceptance and the write-off of a shortage it sent
// are its own facts.
@Injectable()
export class TransferFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = [
    'transfer.dispatched',
    'transfer.accepted',
  ];

  constructor(
    appliers: SyncAppliers,
    private readonly stock: StockFacts,
    private readonly posting: TransferPosting,
    private readonly audit: AuditService,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    if (operation.type === 'transfer.dispatched') {
      return this.dispatched(
        trx,
        operation as AppliedOperation<TransferDispatchedPayload>,
      );
    }
    throw new SyncApplyError('unsupported_type');
  }

  /** A transfer the store sent: `in_transit` with its lines and the negative movements of its batches. */
  private async dispatched(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<TransferDispatchedPayload>,
  ): Promise<void> {
    const { transfer, lines, movements } = payload;
    sameStore(transfer.storeId, storeId);
    const dispatchedAt = storeTime(transfer.dispatchedAt);
    await requireEmployees(trx, tenantId, [
      transfer.createdBy,
      transfer.dispatchedBy,
    ]);
    if (transfer.destinationStoreId === storeId) {
      throw new SyncApplyError('unknown_store');
    }
    const destination = await trx
      .selectFrom('stores')
      .select('status')
      .where('tenantId', '=', tenantId)
      .where('id', '=', transfer.destinationStoreId)
      .executeTakeFirst();
    if (!destination || destination.status !== 'active') {
      throw new SyncApplyError('unknown_store');
    }
    const taken = await trx
      .selectFrom('documents')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', transfer.id)
      .executeTakeFirst();
    if (taken) throw new SyncApplyError('id_reused');
    if (transfer.requestDocumentId !== null) {
      // the request: the store is asked for the goods, the receiver of the transfer asked for them
      const request = await trx
        .selectFrom('documents')
        .select(['type', 'storeId', 'destinationStoreId'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', transfer.requestDocumentId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !request ||
        request.type !== 'transfer_request' ||
        request.storeId !== transfer.destinationStoreId ||
        request.destinationStoreId !== storeId
      ) {
        throw new SyncApplyError('request_mismatch');
      }
    }

    // the lines: batches of the store, one line each
    const batchIds = lines.map((line) => line.sourceBatchId);
    if (
      lines.length === 0 ||
      new Set(batchIds).size !== batchIds.length ||
      lines.some(
        (line) =>
          line.documentId !== transfer.id ||
          !(
            Number.isSafeInteger(line.qtySentPieces) && line.qtySentPieces > 0
          ) ||
          (line.unit !== 'pack' && line.unit !== 'piece'),
      )
    ) {
      throw new SyncApplyError('line_mismatch');
    }
    const own = await this.stock.batchesOf(trx, tenantId, storeId, batchIds);
    if (
      lines.some(
        (line) => own.get(line.sourceBatchId)?.productId !== line.productId,
      )
    ) {
      throw new SyncApplyError('batch_mismatch');
    }
    // one movement per line: −pieces of its batch, on the day of the dispatch
    const byLine = new Map(lines.map((line) => [line.id, line]));
    if (
      movements.length !== lines.length ||
      new Set(movements.map((m) => m.sourceLineId)).size !== lines.length ||
      movements.some((m) => {
        const line = m.sourceLineId ? byLine.get(m.sourceLineId) : undefined;
        return (
          !line ||
          m.kind !== 'transfer_out' ||
          m.sourceType !== 'document' ||
          m.sourceId !== transfer.id ||
          m.batchId !== line.sourceBatchId ||
          m.qtyDeltaPieces !== -line.qtySentPieces ||
          m.businessDate !== transfer.documentDate ||
          m.reversesMovementId !== null
        );
      })
    ) {
      throw new SyncApplyError('movement_mismatch');
    }

    await trx
      .insertInto('documents')
      .values({
        tenantId,
        id: transfer.id,
        storeId,
        type: 'transfer',
        number: transfer.number,
        documentDate: transfer.documentDate,
        status: 'in_transit',
        comment: transfer.comment,
        createdBy: transfer.createdBy,
        destinationStoreId: transfer.destinationStoreId,
        requestDocumentId: transfer.requestDocumentId,
        dispatchedAt,
        dispatchedBy: transfer.dispatchedBy,
      })
      .execute();
    await trx
      .insertInto('transferLines')
      .values(
        lines.map((line) => ({
          tenantId,
          id: line.id,
          documentId: transfer.id,
          lineNo: line.lineNo,
          productId: line.productId,
          sourceBatchId: line.sourceBatchId,
          qtySentPieces: line.qtySentPieces,
          unit: line.unit,
        })),
      )
      .execute();
    await this.stock.insertMovements(trx, tenantId, storeId, movements);
    if (transfer.requestDocumentId !== null) {
      await this.posting.requestStatusAfterDispatch(
        trx,
        tenantId,
        transfer.requestDocumentId,
        lines,
      );
    }
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  private async appendAudit(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    rows: SyncAuditRow[],
  ): Promise<void> {
    for (const row of rows) {
      if (row.storeId !== null) sameStore(row.storeId, storeId);
      await this.audit.appendFact(trx, tenantId, row, storeId);
    }
  }
}
