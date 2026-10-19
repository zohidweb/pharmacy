import { Injectable } from '@nestjs/common';
import type {
  ReturnCompletedPayload,
  SyncOperationType,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  isMoney,
  requireEmployees,
  requireTerminal,
  sameStore,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import { StockFacts } from '../inventory/stock-facts';

// A customer return of an offline store applied in the cloud (ADR-0014 §4, amendment 2026-10-02 p. 5; spec
// 2026-10-16-offline-sync, 4.2): the return, its lines and refunds, the movements back to the batches of the
// receipt and the automatic write-off of defect or expired goods in the same operation. The receipt must be a
// receipt of this store already in the cloud — otherwise the return waits for it.
@Injectable()
export class ReturnFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = ['return.completed'];

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
    const { tenantId, storeId, payload } =
      operation as AppliedOperation<ReturnCompletedPayload>;
    const {
      customerReturn: ret,
      lines,
      refunds,
      movements,
      writeOff,
    } = payload;
    sameStore(ret.storeId, storeId);
    await requireTerminal(trx, tenantId, storeId, ret.terminalId);

    const receipt = await trx
      .selectFrom('receipts')
      .select(['id', 'shiftId'])
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('id', '=', ret.receiptId)
      .executeTakeFirst();
    if (!receipt) throw new SyncApplyError('receipt', 'dependency');
    const shift = await trx
      .selectFrom('shifts')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('id', '=', ret.shiftId)
      .executeTakeFirst();
    if (!shift) throw new SyncApplyError('shift', 'dependency');
    await requireEmployees(trx, tenantId, [ret.cashierId]);

    // the returned lines are lines of that receipt, never more than sold minus returned before
    const sold = new Map(
      (
        await trx
          .selectFrom('receiptLines')
          .select(['id', 'qtyPieces', 'batchId'])
          .where('tenantId', '=', tenantId)
          .where('receiptId', '=', receipt.id)
          .execute()
      ).map((line) => [line.id, line]),
    );
    const returnedBefore = new Map(
      (
        await trx
          .selectFrom('customerReturnLines')
          .select(['receiptLineId'])
          .select((eb) => eb.fn.sum<string>('qtyPieces').as('qty'))
          .where('tenantId', '=', tenantId)
          .where('receiptLineId', 'in', [...sold.keys()])
          .groupBy('receiptLineId')
          .execute()
      ).map((row) => [row.receiptLineId, Number(row.qty)]),
    );
    if (lines.length === 0) throw new SyncApplyError('totals_mismatch');
    for (const line of lines) {
      const soldLine = sold.get(line.receiptLineId);
      if (
        line.customerReturnId !== ret.id ||
        !soldLine ||
        !(line.qtyPieces > 0)
      ) {
        throw new SyncApplyError('line_mismatch');
      }
      if (
        (returnedBefore.get(line.receiptLineId) ?? 0) + line.qtyPieces >
        soldLine.qtyPieces
      ) {
        throw new SyncApplyError('over_return');
      }
    }

    // sums: the refund is the amounts of the lines minus their discount shares, paid out by the refunds
    const amounts = lines.reduce((sum, line) => sum + line.amountDirams, 0);
    const shares = lines.reduce(
      (sum, line) => sum + line.discountShareDirams,
      0,
    );
    const refunded = refunds.reduce(
      (sum, refund) => sum + refund.amountDirams,
      0,
    );
    if (
      ![
        ret.refundDirams,
        ret.discountReturnedDirams,
        ...lines.flatMap((l) => [l.amountDirams, l.discountShareDirams]),
        ...refunds.map((r) => r.amountDirams),
      ].every(isMoney) ||
      shares !== ret.discountReturnedDirams ||
      amounts - shares !== ret.refundDirams ||
      refunded !== ret.refundDirams ||
      refunds.some((refund) => refund.customerReturnId !== ret.id)
    ) {
      throw new SyncApplyError('totals_mismatch');
    }

    // one movement back per returned line, into the batch the line was sold from
    const byLine = new Map(lines.map((line) => [line.id, line]));
    if (
      movements.length !== lines.length ||
      movements.some((m) => {
        const line = m.sourceLineId ? byLine.get(m.sourceLineId) : undefined;
        return (
          !line ||
          m.kind !== 'customer_return' ||
          m.sourceType !== 'customer_return' ||
          m.sourceId !== ret.id ||
          m.batchId !== sold.get(line.receiptLineId)?.batchId ||
          m.qtyDeltaPieces !== line.qtyPieces
        );
      })
    ) {
      throw new SyncApplyError('movement_mismatch');
    }
    await this.stock.batchesOf(
      trx,
      tenantId,
      storeId,
      movements.map((m) => m.batchId),
    );

    await trx
      .insertInto('customerReturns')
      .values({
        tenantId,
        id: ret.id,
        storeId,
        shiftId: ret.shiftId,
        terminalId: ret.terminalId,
        cashierId: ret.cashierId,
        receiptId: ret.receiptId,
        number: ret.number,
        returnedAt: ret.returnedAt,
        businessDate: ret.businessDate,
        reason: ret.reason,
        foundWithoutReceipt: ret.foundWithoutReceipt,
        discountReturnedDirams: BigInt(ret.discountReturnedDirams),
        refundDirams: BigInt(ret.refundDirams),
        correlationId: ret.correlationId,
      })
      .execute();
    await trx
      .insertInto('customerReturnLines')
      .values(
        lines.map((line) => ({
          tenantId,
          id: line.id,
          customerReturnId: ret.id,
          receiptId: ret.receiptId,
          receiptLineId: line.receiptLineId,
          qtyPieces: line.qtyPieces,
          amountDirams: BigInt(line.amountDirams),
          discountShareDirams: BigInt(line.discountShareDirams),
        })),
      )
      .execute();
    if (refunds.length > 0) {
      await trx
        .insertInto('customerReturnRefunds')
        .values(
          refunds.map((refund) => ({
            tenantId,
            id: refund.id,
            customerReturnId: ret.id,
            kind: refund.kind,
            amountDirams: BigInt(refund.amountDirams),
          })),
        )
        .execute();
    }
    await this.stock.insertMovements(trx, tenantId, storeId, movements);
    if (writeOff) {
      await this.stock.applyWriteOff(trx, tenantId, storeId, writeOff, ret.id);
    }
    for (const row of payload.audit) {
      if (row.storeId !== null) sameStore(row.storeId, storeId);
      await this.audit.appendFact(trx, tenantId, row, storeId);
    }
  }
}
