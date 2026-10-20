import { Injectable } from '@nestjs/common';
import type {
  DocumentPostedPayload,
  SyncAuditRow,
  SyncGoodsReceiptLineRow,
  SyncInventoryLineRow,
  SyncOpeningBalanceLineRow,
  SyncOperationType,
  SyncSupplierReturnLineRow,
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
import {
  returnAmount,
  SupplierReturnsRepository,
} from './supplier-returns.repository';

type ReceivingLine = SyncGoodsReceiptLineRow | SyncOpeningBalanceLineRow;

/** The reasons of a write-off the store posts by hand (spec 2026-10-12-write-offs). */
const WRITE_OFF_REASONS = new Set(['expired', 'broken', 'defect', 'misgrade']);

/** The columns of a document header that depend on its type. */
interface HeaderColumns {
  supplierId?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  paymentDueDate?: string | null;
  purchaseOrderId?: string | null;
  supplierReturnReason?: string | null;
  inventoryScope?: string | null;
  inventoryCategoryId?: string | null;
  inventoryStartedAt?: Date | null;
  mergeFromProductId?: string | null;
  mergeIntoProductId?: string | null;
}

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
    private readonly returns: SupplierReturnsRepository,
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
    } else if (document.type === 'inventory') {
      await this.stockCount(trx, tenantId, storeId, payload);
    } else if (document.type === 'supplier_return') {
      await this.supplierReturn(trx, tenantId, storeId, payload);
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

    await this.insertHeader(trx, tenantId, storeId, document, total, {
      supplierId: receipt ? document.supplierId : null,
      supplierInvoiceNumber: receipt ? document.supplierInvoiceNumber : null,
      supplierInvoiceDate: receipt ? document.supplierInvoiceDate : null,
      paymentDueDate: receipt ? document.paymentDueDate : null,
      purchaseOrderId: orderId,
    });
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

  /**
   * A stock count: a line of a batch of the store moves it by the difference the store counted (`inventory_gain` /
   * `inventory_loss`); a found product with a counted quantity gets a new surplus batch. The cloud does not
   * recompute the difference — the stock of the store at the count is the store's (ADR-0014 §4): its movements
   * are checked for kind, sign and batch, and the total (Σ |pieces| × the cost of a piece of the batch) against the
   * store's.
   */
  private async stockCount(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    payload: DocumentPostedPayload,
  ): Promise<void> {
    const { document, batches, movements, prices } = payload;
    const lines = payload.lines as SyncInventoryLineRow[];
    if (prices.length > 0) throw new SyncApplyError('price_mismatch');
    if (
      (document.inventoryScope !== 'all' &&
        document.inventoryScope !== 'category') ||
      (document.inventoryScope === 'category') !==
        (document.inventoryCategoryId !== null)
    ) {
      throw new SyncApplyError('document_mismatch');
    }
    if (document.inventoryStartedAt !== null) {
      storeTime(document.inventoryStartedAt);
    }
    const count = (v: unknown): boolean =>
      Number.isSafeInteger(v) && (v as number) >= 0;
    if (
      lines.length === 0 ||
      lines.some(
        (line) =>
          line.documentId !== document.id ||
          !count(line.countedQtyPieces) ||
          !count(line.bookQtyPieces) ||
          (line.soldSinceStartPieces !== null &&
            !count(line.soldSinceStartPieces)) ||
          (line.soldAfterCountPieces !== null &&
            !count(line.soldAfterCountPieces)) ||
          (line.isFound
            ? line.batchId !== null ||
              line.countedQtyPieces > 0 !== (line.surplusBatchId !== null)
            : line.batchId === null || line.surplusBatchId !== null),
      )
    ) {
      throw new SyncApplyError('line_mismatch');
    }
    await requireProducts(trx, tenantId, [
      ...new Set(lines.map((line) => line.productId)),
    ]);
    if (
      document.inventoryCategoryId !== null &&
      !(await this.categoryExists(trx, tenantId, document.inventoryCategoryId))
    ) {
      throw new SyncApplyError('unknown_category');
    }

    // the batches of the counted lines: of the store, of the line's product, one line each
    const counted = lines.flatMap((line) =>
      line.batchId === null ? [] : [line.batchId],
    );
    if (new Set(counted).size !== counted.length) {
      throw new SyncApplyError('batch_mismatch');
    }
    const existing = await this.stock.batchesOf(
      trx,
      tenantId,
      storeId,
      counted,
    );
    if (
      lines.some(
        (line) =>
          line.batchId !== null &&
          existing.get(line.batchId)?.productId !== line.productId,
      )
    ) {
      throw new SyncApplyError('batch_mismatch');
    }
    // the surplus batches of the found lines, as the lines describe them
    const surplus = new Map(batches.map((batch) => [batch.id, batch]));
    const found = lines.filter((line) => line.surplusBatchId !== null);
    if (
      surplus.size !== batches.length ||
      batches.length !== found.length ||
      found.some((line) => {
        const batch = surplus.get(line.surplusBatchId as string);
        return (
          !batch ||
          batch.storeId !== storeId ||
          batch.productId !== line.productId ||
          batch.origin !== 'inventory_surplus' ||
          batch.sourceDocumentId !== document.id ||
          batch.expiryDate !== line.surplusExpiryDate ||
          batch.lotNumber !== line.surplusLotNumber ||
          batch.purchasePricePerPackDirams !==
            line.surplusPurchasePricePerPackDirams ||
          !isMoney(batch.purchasePricePerPackDirams) ||
          !isMoney(batch.costPerPieceDirams) ||
          batch.supplierId !== null ||
          batch.isStarting
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

    // at most one movement per line; a found line moves its surplus batch by what was counted
    const byLine = new Map(lines.map((line) => [line.id, line]));
    const lineOf = (m: { sourceLineId: string | null }) =>
      m.sourceLineId ? byLine.get(m.sourceLineId) : undefined;
    if (
      new Set(movements.map((m) => m.sourceLineId)).size !== movements.length ||
      movements.filter((m) => lineOf(m)?.isFound === true).length !==
        found.length ||
      movements.some((m) => {
        const line = lineOf(m);
        if (
          !line ||
          m.sourceType !== 'document' ||
          m.sourceId !== document.id ||
          m.businessDate !== document.documentDate ||
          m.reversesMovementId !== null
        ) {
          return true;
        }
        return line.isFound
          ? m.batchId !== line.surplusBatchId ||
              m.kind !== 'inventory_gain' ||
              m.qtyDeltaPieces !== line.countedQtyPieces
          : m.batchId !== line.batchId ||
              !(
                (m.kind === 'inventory_gain' && m.qtyDeltaPieces > 0) ||
                (m.kind === 'inventory_loss' && m.qtyDeltaPieces < 0)
              );
      })
    ) {
      throw new SyncApplyError('movement_mismatch');
    }
    const costOf = (batchId: string): bigint =>
      existing.get(batchId)?.costPerPieceDirams ??
      BigInt(surplus.get(batchId)?.costPerPieceDirams ?? 0);
    const total = movements.reduce(
      (sum, m) => sum + BigInt(Math.abs(m.qtyDeltaPieces)) * costOf(m.batchId),
      0n,
    );
    if (
      total > BigInt(Number.MAX_SAFE_INTEGER) ||
      document.totalDirams !== Number(total)
    ) {
      throw new SyncApplyError('total_mismatch');
    }

    await this.insertHeader(trx, tenantId, storeId, document, Number(total), {
      inventoryScope: document.inventoryScope,
      inventoryCategoryId: document.inventoryCategoryId,
      inventoryStartedAt:
        document.inventoryStartedAt === null
          ? null
          : storeTime(document.inventoryStartedAt),
    });
    if (batches.length > 0) {
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
            purchasePricePerPackDirams: BigInt(
              batch.purchasePricePerPackDirams,
            ),
            costPerPieceDirams: BigInt(batch.costPerPieceDirams),
            supplierId: null,
            origin: 'inventory_surplus',
            sourceDocumentId: document.id,
            isStarting: false,
          })),
        )
        .execute();
    }
    await trx
      .insertInto('inventoryLines')
      .values(
        lines.map((line) => ({
          tenantId,
          id: line.id,
          documentId: document.id,
          lineNo: line.lineNo,
          productId: line.productId,
          batchId: line.batchId,
          isFound: line.isFound,
          bookQtyPieces: line.bookQtyPieces,
          countedQtyPieces: line.countedQtyPieces,
          soldSinceStartPieces: line.soldSinceStartPieces,
          soldAfterCountPieces: line.soldAfterCountPieces,
          surplusBatchId: line.surplusBatchId,
          surplusExpiryDate: line.surplusExpiryDate,
          surplusLotNumber: line.surplusLotNumber,
          surplusPurchasePricePerPackDirams:
            line.surplusPurchasePricePerPackDirams === null
              ? null
              : BigInt(line.surplusPurchasePricePerPackDirams),
        })),
      )
      .execute();
    if (movements.length > 0) {
      await this.stock.insertMovements(trx, tenantId, storeId, movements);
    }
  }

  /**
   * A supplier return: its lines leave their batches, the supplier gets a credit by the code of the cloud
   * (`SupplierLedger.returnPosted`). A batch must have come from the supplier of the return, or the credit would go
   * to another supplier. The amount of a line is checked with the store's pack size (spec 13, PR 2b I1) and the
   * total against the store's.
   */
  private async supplierReturn(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    payload: DocumentPostedPayload,
  ): Promise<void> {
    const { document, batches, movements, prices } = payload;
    const lines = payload.lines as SyncSupplierReturnLineRow[];
    if (batches.length > 0 || prices.length > 0) {
      throw new SyncApplyError('document_mismatch');
    }
    if (document.supplierId === null || !document.supplierReturnReason) {
      throw new SyncApplyError('document_mismatch');
    }
    await this.requireSuppliers(trx, tenantId, [document.supplierId]);
    if (
      lines.length === 0 ||
      lines.some(
        (line) =>
          line.documentId !== document.id ||
          !(Number.isSafeInteger(line.qtyPieces) && line.qtyPieces > 0) ||
          (line.unit !== 'pack' && line.unit !== 'piece') ||
          !(
            Number.isSafeInteger(line.piecesPerPack) && line.piecesPerPack >= 1
          ) ||
          !isMoney(line.amountDirams),
      )
    ) {
      throw new SyncApplyError('line_mismatch');
    }
    const batchIds = lines.map((line) => line.batchId);
    if (new Set(batchIds).size !== batchIds.length) {
      throw new SyncApplyError('batch_mismatch');
    }
    const own = await this.stock.batchesOf(trx, tenantId, storeId, batchIds);
    if (
      lines.some((line) => {
        const batch = own.get(line.batchId);
        return (
          !batch ||
          batch.productId !== line.productId ||
          batch.supplierId !== document.supplierId
        );
      })
    ) {
      throw new SyncApplyError('batch_mismatch');
    }
    const amounts = lines.map((line) => {
      const batch = own.get(line.batchId) as NonNullable<
        ReturnType<typeof own.get>
      >;
      return returnAmount({
        qtyPieces: line.qtyPieces,
        unit: line.unit,
        purchasePricePerPackDirams: batch.purchasePricePerPackDirams,
        costPerPieceDirams: batch.costPerPieceDirams,
        piecesPerPack: line.piecesPerPack,
      });
    });
    const total = amounts.reduce((sum, a) => sum + a, 0);
    if (
      lines.some((line, i) => line.amountDirams !== amounts[i]) ||
      !Number.isSafeInteger(total) ||
      document.totalDirams !== total
    ) {
      throw new SyncApplyError('total_mismatch');
    }
    // one movement per line: −pieces of its batch
    const byLine = new Map(lines.map((line) => [line.id, line]));
    if (
      movements.length !== lines.length ||
      new Set(movements.map((m) => m.sourceLineId)).size !== lines.length ||
      movements.some((m) => {
        const line = m.sourceLineId ? byLine.get(m.sourceLineId) : undefined;
        return (
          !line ||
          m.kind !== 'supplier_return' ||
          m.sourceType !== 'document' ||
          m.sourceId !== document.id ||
          m.batchId !== line.batchId ||
          m.qtyDeltaPieces !== -line.qtyPieces ||
          m.businessDate !== document.documentDate ||
          m.reversesMovementId !== null
        );
      })
    ) {
      throw new SyncApplyError('movement_mismatch');
    }

    await this.insertHeader(trx, tenantId, storeId, document, total, {
      supplierId: document.supplierId,
      supplierReturnReason: document.supplierReturnReason,
    });
    await trx
      .insertInto('supplierReturnLines')
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
          amountDirams: BigInt(line.amountDirams),
          note: line.note,
        })),
      )
      .execute();
    await this.stock.insertMovements(trx, tenantId, storeId, movements);
    const receipts = await this.returns.receiptsOfBatches(
      trx,
      tenantId,
      batchIds,
    );
    await this.ledger.returnPosted(trx, {
      tenantId,
      supplierId: document.supplierId,
      storeLegalEntityId: await this.legalEntityOf(trx, tenantId, storeId),
      documentId: document.id,
      businessDate: document.documentDate,
      employeeId: document.postedBy as string,
      lines: lines.map((line, i) => ({
        receiptId: receipts.get(line.batchId) ?? null,
        amountDirams: amounts[i],
      })),
    });
  }

  /**
   * The header of a posted document of the store, common to every type: the store's id, number and dates, its
   * time of posting parsed (spec 13, PR 2b M5), the total the cloud checked, and the columns of the type.
   */
  private async insertHeader(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    document: DocumentPostedPayload['document'],
    total: number | null,
    extra: HeaderColumns,
  ): Promise<void> {
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
        postedAt: storeTime(document.postedAt),
        postedBy: document.postedBy,
        totalDirams: total === null ? null : BigInt(total),
        ...extra,
      })
      .execute();
  }

  private async categoryExists(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom('categories')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
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
