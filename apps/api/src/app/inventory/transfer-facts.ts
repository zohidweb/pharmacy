import { Injectable } from '@nestjs/common';
import type {
  SyncAuditRow,
  SyncOperationType,
  TransferAcceptedPayload,
  TransferDispatchedPayload,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
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
import { LocalPriceRule } from '../pricing/local-price-rule';
import { DocumentsRepository } from './documents.repository';
import { InventoryRepository } from './inventory.repository';
import { StockFacts } from './stock-facts';
import { TransferPosting } from './transfer-posting';
import { TransfersRepository } from './transfers.repository';

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
    private readonly documents: DocumentsRepository,
    private readonly transfers: TransfersRepository,
    private readonly inventory: InventoryRepository,
    private readonly prices: LocalPriceRule,
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
    if (operation.type === 'transfer.accepted') {
      return this.accepted(
        trx,
        operation as AppliedOperation<TransferAcceptedPayload>,
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

  /**
   * A transfer the store accepted: the receiver's batches with the values of the sender's, the pieces received per
   * line, the sender's price copied as a local price of the store (E18). A shortage is written off at the sender —
   * by the cloud when the sender is a cloud store (as its own acceptance does), by the sender itself when it is an
   * offline store (E34): the cloud never writes its stock.
   */
  private async accepted(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<TransferAcceptedPayload>,
  ): Promise<void> {
    const receivedAt = storeTime(payload.receivedAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.receivedDate)) {
      throw new SyncApplyError('invalid_time');
    }
    await requireEmployees(trx, tenantId, [payload.receivedBy]);
    const doc = await this.documents.findDocument(
      trx,
      tenantId,
      'transfer',
      payload.transferId,
      true,
    );
    if (doc === null) {
      const other = await trx
        .selectFrom('documents')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('id', '=', payload.transferId)
        .executeTakeFirst();
      // not a transfer at all, or the dispatch of an offline sender that has not arrived yet
      if (other) throw new SyncApplyError('store_mismatch');
      throw new SyncApplyError('transfer', 'dependency');
    }
    if (doc.destinationStoreId !== storeId) {
      throw new SyncApplyError('store_mismatch');
    }
    if (doc.status !== 'in_transit') {
      throw new SyncApplyError('transfer_not_in_transit');
    }
    const lines = await this.transfers.transferLines(trx, tenantId, doc.id);

    // every line of the transfer once, 0…sent pieces; a target batch exactly for what was received
    const given = new Map(payload.lines.map((line) => [line.lineId, line]));
    if (
      given.size !== payload.lines.length ||
      given.size !== lines.length ||
      lines.some((line) => {
        const got = given.get(line.id);
        return (
          !got ||
          !Number.isSafeInteger(got.qtyReceivedPieces) ||
          got.qtyReceivedPieces < 0 ||
          got.qtyReceivedPieces > line.qtySentPieces ||
          got.qtyReceivedPieces > 0 !== (got.targetBatchId !== null)
        );
      })
    ) {
      throw new SyncApplyError('line_mismatch');
    }
    const received = lines.filter(
      (line) => (given.get(line.id)?.qtyReceivedPieces ?? 0) > 0,
    );
    const batches = new Map(payload.batches.map((batch) => [batch.id, batch]));
    if (
      batches.size !== payload.batches.length ||
      batches.size !== received.length ||
      received.some((line) => {
        const batch = batches.get(given.get(line.id)?.targetBatchId as string);
        return (
          !batch ||
          batch.storeId !== storeId ||
          batch.productId !== line.productId ||
          batch.origin !== 'transfer' ||
          batch.sourceDocumentId !== doc.id ||
          batch.expiryDate !== line.expiryDate ||
          batch.lotNumber !== line.lotNumber ||
          BigInt(batch.purchasePricePerPackDirams) !==
            BigInt(line.purchasePricePerPackDirams) ||
          BigInt(batch.costPerPieceDirams) !==
            BigInt(line.costPerPieceDirams) ||
          batch.supplierId !== line.supplierId ||
          batch.isStarting
        );
      })
    ) {
      throw new SyncApplyError('batch_mismatch');
    }
    if (received.length > 0) {
      const taken = await trx
        .selectFrom('batches')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('id', 'in', [...batches.keys()])
        .executeTakeFirst();
      if (taken) throw new SyncApplyError('id_reused');
    }

    // one movement per received line: +pieces into its target batch, on the day of the acceptance
    const byLine = new Map(lines.map((line) => [line.id, line]));
    const { movements } = payload;
    if (
      movements.length !== received.length ||
      new Set(movements.map((m) => m.sourceLineId)).size !== movements.length ||
      movements.some((m) => {
        const line = m.sourceLineId ? byLine.get(m.sourceLineId) : undefined;
        const got = line ? given.get(line.id) : undefined;
        return (
          !line ||
          !got ||
          m.kind !== 'transfer_in' ||
          m.sourceType !== 'document' ||
          m.sourceId !== doc.id ||
          m.batchId !== got.targetBatchId ||
          m.qtyDeltaPieces !== got.qtyReceivedPieces ||
          m.businessDate !== payload.receivedDate ||
          m.reversesMovementId !== null
        );
      })
    ) {
      throw new SyncApplyError('movement_mismatch');
    }
    const receivedProducts = new Set(received.map((line) => line.productId));
    if (
      payload.prices.some((price) => !receivedProducts.has(price.productId))
    ) {
      throw new SyncApplyError('price_mismatch');
    }

    // the sender's batches first, in the order of their ids, as the cloud's acceptance takes them
    await this.documents.lockBatches(
      trx,
      tenantId,
      lines.map((line) => line.sourceBatchId),
    );
    if (received.length > 0) {
      await trx
        .insertInto('batches')
        .values(
          received.map((line) => {
            const batch = batches.get(
              given.get(line.id)?.targetBatchId as string,
            ) as NonNullable<ReturnType<typeof batches.get>>;
            return {
              tenantId,
              id: batch.id,
              storeId,
              productId: line.productId,
              expiryDate: line.expiryDate,
              lotNumber: line.lotNumber,
              purchasePricePerPackDirams: BigInt(
                line.purchasePricePerPackDirams,
              ),
              costPerPieceDirams: BigInt(line.costPerPieceDirams),
              supplierId: line.supplierId,
              origin: 'transfer',
              sourceDocumentId: doc.id,
              sourceBatchId: line.sourceBatchId,
              isStarting: false,
            };
          }),
        )
        .execute();
    }
    for (const line of lines) {
      const got = given.get(line.id);
      await this.transfers.setReceived(
        trx,
        tenantId,
        line.id,
        got?.qtyReceivedPieces ?? 0,
        got?.targetBatchId ?? null,
      );
    }
    if (movements.length > 0) {
      await this.stock.insertMovements(trx, tenantId, storeId, movements);
    }
    for (const price of [...payload.prices].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    )) {
      await this.prices.apply(trx, tenantId, storeId, price);
    }
    const comment = payload.comment?.trim() || null;
    await trx
      .updateTable('documents')
      .set({
        status: 'received',
        receivedAt,
        receivedBy: payload.receivedBy,
        receivedComment: comment,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', doc.id)
      .execute();

    // the shortage: a cloud sender's is written off by the cloud now; an offline sender writes off its own (E34)
    const sender = await trx
      .selectFrom('stores')
      .select('mode')
      .where('tenantId', '=', tenantId)
      .where('id', '=', doc.storeId)
      .executeTakeFirstOrThrow();
    const short = lines
      .map((line) => ({
        line,
        missing:
          line.qtySentPieces - (given.get(line.id)?.qtyReceivedPieces ?? 0),
      }))
      .filter((s) => s.missing > 0);
    if (sender.mode === 'online' && short.length > 0) {
      const { today } = await this.inventory.settings(trx, tenantId);
      await this.posting.writeOffShortageAtCloudSender(
        trx,
        { tenantId, employeeId: payload.receivedBy },
        doc,
        short,
        comment ?? '',
        today,
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
