import { Injectable } from '@nestjs/common';
import type {
  ReceiptCompletedPayload,
  ShiftCashCollectedPayload,
  ShiftClosedPayload,
  ShiftOpenedPayload,
  SyncOperationType,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  isMoney,
  requireEmployees,
  requireProducts,
  requireTerminal,
  sameStore,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import { StockFacts } from '../inventory/stock-facts';

// The POS facts of an offline store applied in the cloud (ADR-0014 §4; spec 2026-10-16-offline-sync, 4.2, PR 1):
// shifts and receipts go in with the ids and numbers of the store, as the store wrote them; the cloud checks the
// references and the sums, never the stock (a sale is a fact).
@Injectable()
export class PosFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = [
    'receipt.completed',
    'shift.opened',
    'shift.cash-collected',
    'shift.closed',
  ];

  constructor(
    appliers: SyncAppliers,
    private readonly stock: StockFacts,
    private readonly audit: AuditService,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    switch (operation.type) {
      case 'receipt.completed':
        return this.receipt(
          trx,
          operation as AppliedOperation<ReceiptCompletedPayload>,
        );
      case 'shift.opened':
        return this.shiftOpened(
          trx,
          operation as AppliedOperation<ShiftOpenedPayload>,
        );
      case 'shift.cash-collected':
        return this.cash(
          trx,
          operation as AppliedOperation<ShiftCashCollectedPayload>,
        );
      case 'shift.closed':
        return this.shiftClosed(
          trx,
          operation as AppliedOperation<ShiftClosedPayload>,
        );
      default:
        throw new SyncApplyError('unsupported_type');
    }
  }

  private async shiftOpened(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<ShiftOpenedPayload>,
  ): Promise<void> {
    const { shift } = payload;
    sameStore(shift.storeId, storeId);
    if (!isMoney(shift.openingCashDirams))
      throw new SyncApplyError('amount_invalid');
    await requireTerminal(trx, tenantId, storeId, shift.terminalId);
    await requireEmployees(trx, tenantId, [shift.openedBy]);
    await trx
      .insertInto('shifts')
      .values({
        tenantId,
        id: shift.id,
        storeId,
        terminalId: shift.terminalId,
        number: shift.number,
        status: 'open',
        openedBy: shift.openedBy,
        openedAt: shift.openedAt,
        receivedAt: sql<Date>`now()`,
        openingCashDirams: BigInt(shift.openingCashDirams),
        openedAuthorFlagged: shift.openedAuthorFlagged,
      })
      .execute();
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  private async cash(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<ShiftCashCollectedPayload>,
  ): Promise<void> {
    const { operation } = payload;
    if (!isMoney(operation.amountDirams) || operation.amountDirams === 0) {
      throw new SyncApplyError('amount_invalid');
    }
    await this.shiftOf(trx, tenantId, storeId, operation.shiftId);
    await requireEmployees(trx, tenantId, [operation.employeeId]);
    await trx
      .insertInto('shiftCashOperations')
      .values({
        tenantId,
        id: operation.id,
        shiftId: operation.shiftId,
        kind: operation.kind,
        amountDirams: BigInt(operation.amountDirams),
        reason: operation.reason,
        comment: operation.comment,
        employeeId: operation.employeeId,
        occurredAt: operation.occurredAt,
        receivedAt: sql<Date>`now()`,
        authorFlagged: operation.authorFlagged,
      })
      .execute();
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  private async shiftClosed(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<ShiftClosedPayload>,
  ): Promise<void> {
    const { shift } = payload;
    const current = await this.shiftOf(trx, tenantId, storeId, shift.id);
    if (current.status !== 'open') throw new SyncApplyError('shift_closed');
    // the expected cash may be negative: a cash-out above it is only a warning on the POS (E15 of the POS spec)
    if (
      !Number.isSafeInteger(shift.expectedCashDirams) ||
      !isMoney(shift.countedCashDirams) ||
      !Number.isSafeInteger(shift.discrepancyDirams) ||
      shift.discrepancyDirams !==
        shift.countedCashDirams - shift.expectedCashDirams
    ) {
      throw new SyncApplyError('totals_mismatch');
    }
    await requireEmployees(trx, tenantId, [shift.closedBy]);
    await trx
      .updateTable('shifts')
      .set({
        status: 'closed',
        closedBy: shift.closedBy,
        closedAt: shift.closedAt,
        closedAuthorFlagged: shift.closedAuthorFlagged,
        expectedCashDirams: BigInt(shift.expectedCashDirams),
        countedCashDirams: BigInt(shift.countedCashDirams),
        discrepancyDirams: BigInt(shift.discrepancyDirams),
        discrepancyReason: shift.discrepancyReason,
        terminalTotals:
          shift.terminalTotals === null
            ? null
            : JSON.stringify(shift.terminalTotals),
        zReport: JSON.stringify(shift.zReport),
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', shift.id)
      .execute();
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  private async receipt(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<ReceiptCompletedPayload>,
  ): Promise<void> {
    const { receipt, lines, payments, controlledRecords, movements } = payload;
    sameStore(receipt.storeId, storeId);
    await requireTerminal(trx, tenantId, storeId, receipt.terminalId);
    const shift = await this.shiftOf(trx, tenantId, storeId, receipt.shiftId);
    if (shift.terminalId !== receipt.terminalId)
      throw new SyncApplyError('shift_mismatch');
    await requireEmployees(trx, tenantId, [
      receipt.cashierId,
      ...controlledRecords.map((record) => record.recordedBy),
    ]);
    await requireProducts(
      trx,
      tenantId,
      lines.map((line) => line.productId),
    );
    const batches = await this.stock.batchesOf(
      trx,
      tenantId,
      storeId,
      lines.map((line) => line.batchId),
    );

    // the sums of the receipt, as the store must have computed them (spec 4.3)
    const money = [
      receipt.subtotalDirams,
      receipt.discountDirams,
      receipt.totalDirams,
      receipt.cashTenderedDirams,
      receipt.changeDirams,
      ...lines.flatMap((l) => [
        l.unitPriceDirams,
        l.lineAmountDirams,
        l.discountShareDirams,
        l.costDirams,
      ]),
      ...payments.map((p) => p.amountDirams),
    ];
    const subtotal = lines.reduce(
      (sum, line) => sum + line.lineAmountDirams,
      0,
    );
    const paid = payments.reduce(
      (sum, payment) => sum + payment.amountDirams,
      0,
    );
    if (
      lines.length === 0 ||
      !money.every(isMoney) ||
      subtotal !== receipt.subtotalDirams ||
      receipt.totalDirams !== receipt.subtotalDirams - receipt.discountDirams ||
      paid !== receipt.totalDirams + receipt.changeDirams ||
      lines.some(
        (line) => line.receiptId !== receipt.id || !(line.qtyPieces > 0),
      ) ||
      payments.some((payment) => payment.receiptId !== receipt.id)
    ) {
      throw new SyncApplyError('totals_mismatch');
    }
    if (
      lines.some(
        (line) => batches.get(line.batchId)?.productId !== line.productId,
      )
    ) {
      throw new SyncApplyError('batch_mismatch');
    }
    const lineIds = new Set(lines.map((line) => line.id));
    const lineBatch = new Map(lines.map((line) => [line.id, line.batchId]));
    if (
      controlledRecords.some((record) => !lineIds.has(record.receiptLineId))
    ) {
      throw new SyncApplyError('controlled_mismatch');
    }
    // every line sells its pieces from its batch: Σ sale movements of a line = −pieces
    const sold = new Map<string, number>();
    for (const m of movements) {
      if (
        m.kind !== 'sale' ||
        m.sourceType !== 'receipt' ||
        m.sourceId !== receipt.id ||
        !m.sourceLineId ||
        !lineIds.has(m.sourceLineId) ||
        m.batchId !== lineBatch.get(m.sourceLineId) ||
        m.qtyDeltaPieces >= 0
      ) {
        throw new SyncApplyError('movement_mismatch');
      }
      sold.set(
        m.sourceLineId,
        (sold.get(m.sourceLineId) ?? 0) - m.qtyDeltaPieces,
      );
    }
    if (lines.some((line) => sold.get(line.id) !== line.qtyPieces)) {
      throw new SyncApplyError('movement_mismatch');
    }

    await trx
      .insertInto('receipts')
      .values({
        tenantId,
        id: receipt.id,
        storeId,
        terminalId: receipt.terminalId,
        shiftId: receipt.shiftId,
        cashierId: receipt.cashierId,
        number: receipt.number,
        soldAt: receipt.soldAt,
        receivedAt: sql<Date>`now()`,
        businessDate: receipt.businessDate,
        subtotalDirams: BigInt(receipt.subtotalDirams),
        discountRuleId: receipt.discountRuleId,
        discountPercentBp: receipt.discountPercentBp,
        discountMinTotalDirams:
          receipt.discountMinTotalDirams === null
            ? null
            : BigInt(receipt.discountMinTotalDirams),
        discountDirams: BigInt(receipt.discountDirams),
        totalDirams: BigInt(receipt.totalDirams),
        cashTenderedDirams: BigInt(receipt.cashTenderedDirams),
        changeDirams: BigInt(receipt.changeDirams),
        discrepancyKinds: receipt.discrepancyKinds,
        correlationId: receipt.correlationId,
        origin: 'offline_store',
        language: receipt.language,
      })
      .execute();
    await trx
      .insertInto('receiptLines')
      .values(
        lines.map((line) => ({
          tenantId,
          id: line.id,
          receiptId: receipt.id,
          lineNo: line.lineNo,
          productId: line.productId,
          batchId: line.batchId,
          saleUnit: line.saleUnit,
          piecesPerPack: line.piecesPerPack,
          qtyPieces: line.qtyPieces,
          unitPriceDirams: BigInt(line.unitPriceDirams),
          lineAmountDirams: BigInt(line.lineAmountDirams),
          discountShareDirams: BigInt(line.discountShareDirams),
          costDirams: BigInt(line.costDirams),
          batchChosenManually: line.batchChosenManually,
          shortfallPieces: line.shortfallPieces,
          currentPriceDirams:
            line.currentPriceDirams === null
              ? null
              : BigInt(line.currentPriceDirams),
        })),
      )
      .execute();
    if (payments.length > 0) {
      await trx
        .insertInto('payments')
        .values(
          payments.map((payment) => ({
            tenantId,
            id: payment.id,
            receiptId: receipt.id,
            kind: payment.kind,
            amountDirams: BigInt(payment.amountDirams),
          })),
        )
        .execute();
    }
    if (controlledRecords.length > 0) {
      await trx
        .insertInto('controlledSaleRecords')
        .values(
          controlledRecords.map((record) => ({
            tenantId,
            id: record.id,
            receiptLineId: record.receiptLineId,
            prescriptionFileId: record.prescriptionFileId,
            prescriptionNote:
              record.prescriptionNote === null
                ? null
                : JSON.stringify(record.prescriptionNote),
            recordedBy: record.recordedBy,
            recordedAt: record.recordedAt,
            // the envelope waited past the retention term and its data was purged (spec 2026-10-21, P5)
            prescriptionPurgedAt:
              record.prescriptionPurged === true ? new Date() : null,
          })),
        )
        .execute();
    }
    await this.stock.insertMovements(trx, tenantId, storeId, movements);
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  /** A shift of the store (a fact of the store): missing — wait for it. */
  private async shiftOf(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    shiftId: string,
  ): Promise<{ status: string; terminalId: string }> {
    const shift = await trx
      .selectFrom('shifts')
      .select(['status', 'terminalId'])
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('id', '=', shiftId)
      .forUpdate()
      .executeTakeFirst();
    if (!shift) throw new SyncApplyError('shift', 'dependency');
    return shift;
  }

  private async appendAudit(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    rows: ReceiptCompletedPayload['audit'],
  ): Promise<void> {
    for (const row of rows) {
      if (row.storeId !== null) sameStore(row.storeId, storeId);
      await this.audit.appendFact(trx, tenantId, row, storeId);
    }
  }
}
