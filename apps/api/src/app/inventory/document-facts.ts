import { Injectable } from '@nestjs/common';
import type {
  DocumentPostedPayload,
  SyncAuditRow,
  SyncGoodsReceiptLineRow,
  SyncOpeningBalanceLineRow,
  SyncOperationType,
  SyncWriteOffLineRow,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  isMoney,
  requireEmployees,
  requireProducts,
  sameStore,
  storeTime,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import { LocalPriceRule } from '../pricing/local-price-rule';
import { OrderReceiving } from '../purchasing/order-receiving';
import { SupplierLedger } from '../purchasing/supplier-ledger';
import { packsTotal } from './posting';
import { StockFacts } from './stock-facts';

type ReceivingLine = SyncGoodsReceiptLineRow | SyncOpeningBalanceLineRow;

/** The reasons of a write-off the store posts by hand (spec 2026-10-12-write-offs). */
const WRITE_OFF_REASONS = new Set(['expired', 'broken', 'defect', 'misgrade']);

// The stock documents an offline store posted, applied in the cloud (ADR-0014 §4; spec 2026-10-16-offline-sync,
// 4.2, E17, E18, E37): the document, its lines, the batches it created and its movements go in with the ids of the
// store. The rules of a posting that are a decision of the person at the store (the date and the closed period,
// active supplier and product, an open order, the freeze of a stock count, the regulated maximum) are not checked
// again: a posted document is a fact. What is checked is the fact itself — references to the network, lines,
// batches and movements that match, signs, integer dirams, ids not yet taken. A goods receipt then does in the
// cloud what the cloud posting does: the debt to the supplier, the retail prices of its lines, the order status.
@Injectable()
export class DocumentFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = ['document.posted'];

  constructor(
    appliers: SyncAppliers,
    private readonly stock: StockFacts,
    private readonly prices: LocalPriceRule,
    private readonly ledger: SupplierLedger,
    private readonly orders: OrderReceiving,
    private readonly audit: AuditService,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    if (operation.type !== 'document.posted') {
      throw new SyncApplyError('unsupported_type');
    }
    const { tenantId, storeId, payload } =
      operation as AppliedOperation<DocumentPostedPayload>;
    const { document } = payload;
    sameStore(document.storeId, storeId);
    if (
      document.status !== 'posted' ||
      document.postedAt === null ||
      document.postedBy === null
    ) {
      throw new SyncApplyError('document_mismatch');
    }
    storeTime(document.postedAt);
    await requireEmployees(trx, tenantId, [
      document.createdBy,
      document.postedBy,
    ]);
    if (await this.taken(trx, tenantId, 'documents', [document.id])) {
      throw new SyncApplyError('id_reused');
    }
    if (
      document.type === 'goods_receipt' ||
      document.type === 'opening_balance'
    ) {
      await this.receiving(trx, tenantId, storeId, payload);
    } else if (document.type === 'write_off') {
      await this.writeOff(trx, tenantId, storeId, payload);
    } else {
      throw new SyncApplyError('unsupported_document_type');
    }
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  /** A goods receipt or opening balances: new batches, positive movements, prices, the supplier debt. */
  private async receiving(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    payload: DocumentPostedPayload,
  ): Promise<void> {
    const { document, batches, movements, prices } = payload;
    const lines = payload.lines as ReceivingLine[];
    const receipt = document.type === 'goods_receipt';
    if (
      lines.length === 0 ||
      lines.some(
        (line) =>
          line.documentId !== document.id ||
          !(Number.isSafeInteger(line.qtyPieces) && line.qtyPieces > 0) ||
          !isMoney(line.purchasePricePerPackDirams),
      )
    ) {
      throw new SyncApplyError('line_mismatch');
    }
    if (receipt && !document.supplierInvoiceNumber) {
      throw new SyncApplyError('document_mismatch');
    }
    const productIds = [...new Set(lines.map((line) => line.productId))];
    await requireProducts(trx, tenantId, productIds);
    // The packs of the store's card at the posting: the cloud card may have changed since. The total is the
    // supplier invoice as the store computed it, checked against its lines (spec 4.3) and taken as the debt.
    for (const line of lines) {
      if (
        !(
          Number.isSafeInteger(line.piecesPerPack) && line.piecesPerPack >= 1
        ) ||
        line.qtyPieces % line.piecesPerPack !== 0
      ) {
        throw new SyncApplyError('pack_mismatch');
      }
    }
    const total = packsTotal(
      lines.map((line) => ({
        packs: line.qtyPieces / line.piecesPerPack,
        pricePerPack: line.purchasePricePerPackDirams,
      })),
    );
    if (document.totalDirams !== total) {
      throw new SyncApplyError('total_mismatch');
    }

    // one new batch per line, made by this document
    const byId = new Map(batches.map((batch) => [batch.id, batch]));
    if (
      batches.length !== lines.length ||
      lines.some((line) => {
        const batch = byId.get(line.batchId);
        return (
          !batch ||
          batch.storeId !== storeId ||
          batch.productId !== line.productId ||
          batch.sourceDocumentId !== document.id ||
          batch.origin !== document.type ||
          batch.purchasePricePerPackDirams !==
            line.purchasePricePerPackDirams ||
          !isMoney(batch.costPerPieceDirams)
        );
      })
    ) {
      throw new SyncApplyError('batch_mismatch');
    }
    if (
      await this.taken(
        trx,
        tenantId,
        'batches',
        batches.map((b) => b.id),
      )
    ) {
      throw new SyncApplyError('id_reused');
    }

    // one movement per line: +pieces into its batch, kind = the type of the document
    const byLine = new Map(lines.map((line) => [line.id, line]));
    if (
      movements.length !== lines.length ||
      new Set(movements.map((m) => m.sourceLineId)).size !== lines.length ||
      movements.some((m) => {
        const line = m.sourceLineId ? byLine.get(m.sourceLineId) : undefined;
        return (
          !line ||
          m.kind !== document.type ||
          m.sourceType !== 'document' ||
          m.sourceId !== document.id ||
          m.batchId !== line.batchId ||
          m.qtyDeltaPieces !== line.qtyPieces ||
          m.businessDate !== document.documentDate ||
          m.reversesMovementId !== null
        );
      })
    ) {
      throw new SyncApplyError('movement_mismatch');
    }
    if (prices.some((price) => !productIds.includes(price.productId))) {
      throw new SyncApplyError('price_mismatch');
    }

    // suppliers of the network: of the receipt, and of the lines of opening balances
    const suppliers = new Set<string>();
    if (receipt) {
      if (document.supplierId === null) {
        throw new SyncApplyError('unknown_supplier');
      }
      suppliers.add(document.supplierId);
    }
    for (const line of lines) {
      const supplierId = 'supplierId' in line ? line.supplierId : null;
      if (supplierId !== null) suppliers.add(supplierId);
    }
    for (const batch of batches) {
      if (batch.supplierId !== null) suppliers.add(batch.supplierId);
    }
    await this.requireSuppliers(trx, tenantId, [...suppliers]);

    // the order first, as the posting of the cloud takes it: order, then batches, then settlements
    const orderId = receipt ? document.purchaseOrderId : null;
    if (orderId !== null) {
      const order = await this.orders.lockedOrder(trx, tenantId, orderId);
      if (order === null) throw new SyncApplyError('unknown_order');
      if (
        order.storeId !== storeId ||
        order.supplierId !== document.supplierId ||
        (lines as SyncGoodsReceiptLineRow[]).some(
          (line) =>
            line.purchaseOrderLineId !== null &&
            !order.lineIds.has(line.purchaseOrderLineId),
        )
      ) {
        throw new SyncApplyError('order_mismatch');
      }
    }

    await trx
      .insertInto('documents')
      .values({
        tenantId,
        id: document.id,
        storeId,
        type: document.type,
        number: document.number,
        documentDate: document.documentDate,
        status: 'posted',
        comment: document.comment,
        createdBy: document.createdBy,
        postedAt: document.postedAt,
        postedBy: document.postedBy,
        supplierId: receipt ? document.supplierId : null,
        supplierInvoiceNumber: receipt ? document.supplierInvoiceNumber : null,
        supplierInvoiceDate: receipt ? document.supplierInvoiceDate : null,
        paymentDueDate: receipt ? document.paymentDueDate : null,
        purchaseOrderId: orderId,
        totalDirams: BigInt(total),
      })
      .execute();
    await trx
      .insertInto('batches')
      .values(
        batches.map((batch) => ({
          tenantId,
          id: batch.id,
          storeId,
          productId: batch.productId,
          expiryDate: batch.expiryDate,
          lotNumber: batch.lotNumber,
          purchasePricePerPackDirams: BigInt(batch.purchasePricePerPackDirams),
          costPerPieceDirams: BigInt(batch.costPerPieceDirams),
          supplierId: batch.supplierId,
          origin: batch.origin,
          sourceDocumentId: document.id,
          isStarting: batch.isStarting,
        })),
      )
      .execute();
    if (receipt) {
      await trx
        .insertInto('goodsReceiptLines')
        .values(
          (lines as SyncGoodsReceiptLineRow[]).map((line) => ({
            tenantId,
            id: line.id,
            documentId: document.id,
            lineNo: line.lineNo,
            productId: line.productId,
            batchId: line.batchId,
            expiryDate: line.expiryDate,
            lotNumber: line.lotNumber,
            qtyPieces: line.qtyPieces,
            purchasePricePerPackDirams: BigInt(line.purchasePricePerPackDirams),
            orderPricePerPackDirams:
              line.orderPricePerPackDirams === null
                ? null
                : BigInt(line.orderPricePerPackDirams),
            purchaseOrderLineId: line.purchaseOrderLineId,
            retailPriceDraftDirams: BigInt(line.retailPriceDraftDirams),
          })),
        )
        .execute();
    } else {
      await trx
        .insertInto('openingBalanceLines')
        .values(
          (lines as SyncOpeningBalanceLineRow[]).map((line) => ({
            tenantId,
            id: line.id,
            documentId: document.id,
            lineNo: line.lineNo,
            productId: line.productId,
            batchId: line.batchId,
            expiryDate: line.expiryDate,
            lotNumber: line.lotNumber,
            qtyPieces: line.qtyPieces,
            purchasePricePerPackDirams: BigInt(line.purchasePricePerPackDirams),
            retailPriceDraftDirams:
              line.retailPriceDraftDirams === null
                ? null
                : BigInt(line.retailPriceDraftDirams),
            supplierId: line.supplierId,
            isStarting: line.isStarting,
          })),
        )
        .execute();
    }
    await this.stock.insertMovements(trx, tenantId, storeId, movements);

    // the prices after the batches, in the order of the products, as every writer of prices (spec E18)
    for (const price of [...prices].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    )) {
      await this.prices.apply(trx, tenantId, storeId, price);
    }
    if (receipt && document.supplierId !== null) {
      await this.ledger.receiptPosted(trx, {
        tenantId,
        supplierId: document.supplierId,
        legalEntityId: await this.legalEntityOf(trx, tenantId, storeId),
        documentId: document.id,
        amountDirams: total,
        dueDate: document.paymentDueDate,
        businessDate: document.documentDate,
        employeeId: document.postedBy as string,
      });
    }
    if (orderId !== null) {
      await this.orders.refreshStatus(trx, tenantId, orderId);
    }
  }

  /**
   * A write-off: the document, its lines and their negative movements by StockFacts (PR 1), the total as the store
   * computes it. The write-off of a transfer discrepancy comes with the transfers (PR 2d); the write-off of a
   * customer return only inside `return.completed`.
   */
  private async writeOff(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    payload: DocumentPostedPayload,
  ): Promise<void> {
    const { document, batches, movements, prices } = payload;
    const reason = document.writeOffReason;
    if (reason === 'transfer_discrepancy') {
      throw new SyncApplyError('unsupported_write_off_reason');
    }
    if (
      reason === null ||
      !WRITE_OFF_REASONS.has(reason) ||
      document.sourceCustomerReturnId !== null ||
      batches.length > 0 ||
      prices.length > 0
    ) {
      throw new SyncApplyError('write_off_mismatch');
    }
    await this.stock.applyWriteOff(
      trx,
      tenantId,
      storeId,
      {
        document,
        lines: payload.lines as SyncWriteOffLineRow[],
        movements,
      },
      null,
    );
  }

  /** Suppliers of the network (cloud-owned, any status): a missing one is a quarantine. */
  private async requireSuppliers(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await trx
      .selectFrom('suppliers')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute();
    if (rows.length !== ids.length) {
      throw new SyncApplyError('unknown_supplier');
    }
  }

  private async legalEntityOf(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<string> {
    const row = await trx
      .selectFrom('stores')
      .select('legalEntityId')
      .where('tenantId', '=', tenantId)
      .where('id', '=', storeId)
      .executeTakeFirstOrThrow();
    return row.legalEntityId;
  }

  /** Whether any of the ids is already a row of the table in the network. */
  private async taken(
    trx: TenantTransaction,
    tenantId: string,
    table: 'documents' | 'batches',
    ids: readonly string[],
  ): Promise<boolean> {
    if (ids.length === 0) return false;
    const row = await trx
      .selectFrom(table)
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .executeTakeFirst();
    return row !== undefined;
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
