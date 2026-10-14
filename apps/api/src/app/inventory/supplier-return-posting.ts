import { Injectable } from '@nestjs/common';
import type { UnpostCheck } from '@pharmacy/shared-dto';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import type { TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { SupplierLedger } from '../purchasing/supplier-ledger';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import {
  InventoryRepository,
  type StoreForWrite,
} from './inventory.repository';
import { checkDocumentDate } from './posting';
import { StockFreeze } from './stock-freeze';
import { StockRepository } from './stock.repository';
import {
  returnAmount,
  withPiecesPerPack,
  type SupplierReturnLineRow,
  SupplierReturnsRepository,
} from './supplier-returns.repository';

// Posting and unposting of a supplier return (spec 2026-10-12-supplier-returns-transfers, section
// 4): the batches go down by `supplier_return` movements and the supplier is credited with their
// purchase cost in the transaction of the caller; unposting reverses both unless a batch moved
// since the posting (B2 of spec 2026-10-12-write-offs-stock-counts).
@Injectable()
export class SupplierReturnPosting {
  constructor(
    private readonly documents: DocumentsRepository,
    private readonly lines: SupplierReturnsRepository,
    private readonly inventory: InventoryRepository,
    private readonly stock: StockRepository,
    private readonly products: ProductsReader,
    private readonly audit: AuditService,
    private readonly freeze: StockFreeze,
    private readonly ledger: SupplierLedger,
  ) {}

  async post(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    store: StoreForWrite,
  ): Promise<void> {
    const { tenantId, employeeId } = ctx;
    const lines = await this.lines.lines(trx, tenantId, doc.id);
    if (lines.length === 0) {
      throw new FieldProblemException(422, 'validation_failed', [
        { field: 'lines', code: 'required' },
      ]);
    }
    // the products of a running stock count of the store are frozen (spec 2026-10-12, 5.3)
    await this.freeze.guard(
      trx,
      tenantId,
      doc.storeId,
      lines.map((l) => l.productId),
    );
    checkDocumentDate(
      await this.inventory.settings(trx, tenantId),
      store,
      doc.documentDate,
      { backdating: true },
    );
    // lock, then count (ADR-0006): two documents of one batch never take the same stock twice
    const batchIds = lines.map((l) => l.batchId);
    await this.documents.lockBatches(trx, tenantId, batchIds);
    const stock = await this.stock.stockOfBatches(
      trx,
      tenantId,
      doc.storeId,
      batchIds,
    );
    const short = lines.flatMap((line, i) =>
      line.qtyPieces > (stock.get(line.batchId) ?? 0)
        ? [{ field: `lines.${i}.quantity`, code: 'stock_insufficient' }]
        : [],
    );
    if (short.length > 0) {
      throw new FieldProblemException(409, 'stock_insufficient', short);
    }
    await this.documents.insertMovements(
      trx,
      tenantId,
      lines.map((line) => ({
        storeId: doc.storeId,
        batchId: line.batchId,
        qtyDeltaPieces: -line.qtyPieces,
        kind: 'supplier_return',
        sourceId: doc.id,
        sourceLineId: line.id,
        businessDate: doc.documentDate,
        reversesMovementId: null,
      })),
    );
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const amounts = withPiecesPerPack(lines, products).map((line) => ({
      id: line.id,
      amountDirams: returnAmount(line),
    }));
    await this.lines.setAmounts(trx, tenantId, amounts);
    const total = amounts.reduce((sum, a) => sum + a.amountDirams, 0);
    await this.documents.markPosted(trx, tenantId, doc.id, employeeId, total);
    const receipts = await this.lines.receiptsOfBatches(
      trx,
      tenantId,
      batchIds,
    );
    await this.ledger.returnPosted(trx, {
      tenantId,
      supplierId: doc.supplierId as string,
      storeLegalEntityId: store.legalEntityId,
      documentId: doc.id,
      businessDate: doc.documentDate,
      employeeId,
      lines: lines.map((line, i) => ({
        receiptId: receipts.get(line.batchId) ?? null,
        amountDirams: amounts[i].amountDirams,
      })),
    });
    await this.audit.append(trx, {
      action: 'document.posted',
      entityType: 'document',
      entityId: doc.id,
      storeId: doc.storeId,
      details: {
        type: doc.type,
        number: doc.number,
        documentDate: doc.documentDate,
        reason: doc.supplierReturnReason,
        lines: lines.length,
        totalMinor: total,
      },
    });
  }

  async unpost(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    store: StoreForWrite,
  ): Promise<void> {
    const { tenantId, employeeId } = ctx;
    if (doc.status !== 'posted')
      throw new ProblemException(409, 'document_not_posted');
    // the reversal is dated by the document: a closed period stays closed
    checkDocumentDate(
      await this.inventory.settings(trx, tenantId),
      store,
      doc.documentDate,
      { backdating: false },
    );
    const lines = await this.lines.lines(trx, tenantId, doc.id);
    await this.freeze.guard(
      trx,
      tenantId,
      doc.storeId,
      lines.map((l) => l.productId),
    );
    if ((await this.blockersOf(trx, tenantId, doc, lines, true)).length > 0) {
      throw new ProblemException(409, 'unpost_blocked');
    }
    await this.documents.reverseMovements(
      trx,
      tenantId,
      doc.id,
      doc.documentDate,
    );
    await this.lines.clearAmounts(trx, tenantId, doc.id);
    await this.documents.markUnposted(trx, tenantId, doc.id, employeeId);
    await this.ledger.returnUnposted(trx, {
      tenantId,
      documentId: doc.id,
      businessDate: doc.documentDate,
      employeeId,
    });
    await this.audit.append(trx, {
      action: 'document.unposted',
      entityType: 'document',
      entityId: doc.id,
      storeId: doc.storeId,
      details: {
        type: doc.type,
        number: doc.number,
        documentDate: doc.documentDate,
        totalMinor: Number(doc.totalDirams ?? 0n),
      },
    });
  }

  /** Batches of the return that moved after its posting. */
  async blockers(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<UnpostCheck['blockers']> {
    const lines = await this.lines.lines(trx, tenantId, doc.id);
    return this.blockersOf(trx, tenantId, doc, lines, false);
  }

  private async blockersOf(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
    lines: readonly SupplierReturnLineRow[],
    lock: boolean,
  ): Promise<UnpostCheck['blockers']> {
    if (doc.postedAt === null) return [];
    const batchIds = lines.map((l) => l.batchId);
    if (lock) await this.documents.lockBatches(trx, tenantId, batchIds);
    const foreign = await this.documents.foreignMovements(
      trx,
      tenantId,
      batchIds,
      doc.id,
      doc.postedAt,
    );
    if (foreign.length === 0) return [];
    const names = new Map(
      (
        await this.products.findForPricing(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p.name]),
    );
    return lines.flatMap((line) => {
      const moves = foreign.filter((m) => m.batchId === line.batchId);
      if (moves.length === 0) return [];
      return [
        {
          productName: names.get(line.productId) ?? '',
          batchNumber: line.lotNumber ?? '',
          soldPieces: -moves
            .filter((m) => m.kind === 'sale')
            .reduce((sum, m) => sum + m.qtyDeltaPieces, 0),
          documents: [
            ...new Set(
              moves.flatMap((m) => (m.sourceNumber ? [m.sourceNumber] : [])),
            ),
          ],
        },
      ];
    });
  }
}
