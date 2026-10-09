import { Injectable } from '@nestjs/common';
import type { UnpostCheck } from '@pharmacy/shared-dto';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { newId, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  type PricingProduct,
  ProductsReader,
} from '../catalog/products-reader';
import { StorePriceWriter } from '../pricing/store-price-writer';
import { SupplierLedger } from '../purchasing/supplier-ledger';
import {
  type DocumentRow,
  DocumentsRepository,
  type LineRow,
} from './documents.repository';
import {
  InventoryRepository,
  type StoreForWrite,
} from './inventory.repository';

const DAY_MS = 86_400_000;

/** Packs of a line: the stock is kept in pieces, a document speaks in packs. */
export const packsOf = (line: LineRow, piecesPerPack: number): number =>
  Math.round(line.qtyPieces / piecesPerPack);

/** Purchase amount of the lines: packs × purchase price of a pack. */
export function linesTotal(
  lines: readonly LineRow[],
  piecesPerPack: (productId: string) => number,
): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      Math.round(
        (line.qtyPieces * Number(line.purchasePricePerPackDirams)) /
          piecesPerPack(line.productId),
      ),
    0,
  );
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const invalid = (field: string, code: string) =>
  new FieldProblemException(422, 'validation_failed', [{ field, code }]);

// Posting and unposting of a stock document (spec 2026-10-09-inventory-purchasing, section 4.1):
// batches, movements, store prices, the supplier debt and the status in one transaction of the
// caller; unposting reverses the movements and the debt unless the batches moved since.
@Injectable()
export class DocumentPosting {
  constructor(
    private readonly documents: DocumentsRepository,
    private readonly inventory: InventoryRepository,
    private readonly products: ProductsReader,
    private readonly prices: StorePriceWriter,
    private readonly ledger: SupplierLedger,
    private readonly audit: AuditService,
  ) {}

  async post(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    store: StoreForWrite,
  ): Promise<void> {
    const { tenantId, employeeId } = ctx;
    const lines = await this.documents.lines(trx, tenantId, doc.type, doc.id);
    if (lines.length === 0) throw invalid('lines', 'required');
    if (doc.type === 'goods_receipt' && !doc.supplierInvoiceNumber) {
      throw invalid('invoiceNumber', 'required');
    }
    const settings = await this.inventory.settings(trx, tenantId);
    if (doc.documentDate > settings.today) throw invalid('date', 'future');
    if (
      doc.documentDate < shiftDays(settings.today, -settings.backdatingMaxDays)
    ) {
      throw invalid('date', 'too_old');
    }
    if (store.closedUntil !== null && doc.documentDate <= store.closedUntil) {
      throw new FieldProblemException(422, 'period_closed', [
        { field: 'date', code: 'period_closed' },
      ]);
    }
    const products = await this.productMap(trx, tenantId, lines);
    for (const [i, line] of lines.entries()) {
      if (products.get(line.productId)?.status !== 'active') {
        throw new FieldProblemException(409, 'product_archived', [
          { field: `lines.${i}.productId`, code: 'product_archived' },
        ]);
      }
    }

    for (const [i, line] of lines.entries()) {
      const product = products.get(line.productId) as PricingProduct;
      let batchId = line.batchId;
      if (batchId === null) {
        batchId = newId();
        const price = Number(line.purchasePricePerPackDirams);
        await this.documents.insertBatch(trx, tenantId, {
          id: batchId,
          storeId: doc.storeId,
          productId: line.productId,
          expiryDate: line.expiryDate,
          lotNumber: line.lotNumber,
          purchasePricePerPackDirams: price,
          // the cost of a piece is rounded up, in favour of the pharmacy (ТЗ)
          costPerPieceDirams: Math.ceil(price / product.piecesPerPack),
          supplierId: doc.supplierId,
          origin: doc.type,
          sourceDocumentId: doc.id,
          isStarting: line.isStarting,
        });
        await this.documents.setLineBatch(
          trx,
          tenantId,
          doc.type,
          line.id,
          batchId,
        );
      }
      await this.documents.insertMovements(trx, tenantId, [
        {
          storeId: doc.storeId,
          batchId,
          qtyDeltaPieces: line.qtyPieces,
          kind: doc.type,
          sourceId: doc.id,
          sourceLineId: line.id,
          businessDate: doc.documentDate,
          reversesMovementId: null,
        },
      ]);
      if (line.retailPriceDraftDirams !== null) {
        await this.prices.set(trx, {
          tenantId,
          productId: line.productId,
          storeId: doc.storeId,
          priceMinor: Number(line.retailPriceDraftDirams),
          maxPriceMinor: product.maxPriceMinor,
          confirmAboveMax: false,
          field: `lines.${i}.retailPriceMinor`,
          source: 'document',
          documentId: doc.id,
        });
      }
    }

    const total = linesTotal(
      lines,
      (id) => products.get(id)?.piecesPerPack ?? 1,
    );
    if (doc.type === 'goods_receipt' && doc.supplierId !== null) {
      await this.ledger.receiptPosted(trx, {
        tenantId,
        supplierId: doc.supplierId,
        legalEntityId: store.legalEntityId,
        documentId: doc.id,
        amountDirams: total,
        dueDate: doc.paymentDueDate,
        businessDate: doc.documentDate,
        employeeId,
      });
    }
    await this.documents.markPosted(trx, tenantId, doc.id, employeeId, total);
    await this.audit.append(trx, {
      action: 'document.posted',
      entityType: 'document',
      entityId: doc.id,
      storeId: doc.storeId,
      details: {
        type: doc.type,
        number: doc.number,
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
    // the reversal is dated by the document: a closed period stays closed (spec 4.1)
    if (store.closedUntil !== null && doc.documentDate <= store.closedUntil) {
      throw new FieldProblemException(422, 'period_closed', [
        { field: 'date', code: 'period_closed' },
      ]);
    }
    const lines = await this.documents.lines(trx, tenantId, doc.type, doc.id);
    const blockers = await this.blockersOf(trx, tenantId, doc, lines, true);
    if (blockers.length > 0) throw new ProblemException(409, 'unpost_blocked');

    const movements = await this.documents.documentMovements(
      trx,
      tenantId,
      doc.id,
    );
    const reversed = new Set(
      movements.flatMap((m) =>
        m.reversesMovementId ? [m.reversesMovementId] : [],
      ),
    );
    await this.documents.insertMovements(
      trx,
      tenantId,
      movements
        .filter((m) => m.kind !== 'reversal' && !reversed.has(m.id))
        .map((m) => ({
          storeId: m.storeId,
          batchId: m.batchId,
          qtyDeltaPieces: -m.qtyDeltaPieces,
          kind: 'reversal',
          sourceId: doc.id,
          sourceLineId: m.sourceLineId,
          businessDate: doc.documentDate,
          reversesMovementId: m.id,
        })),
    );
    const total = Number(doc.totalDirams ?? 0n);
    if (doc.type === 'goods_receipt' && doc.supplierId !== null) {
      await this.ledger.receiptUnposted(trx, {
        tenantId,
        documentId: doc.id,
        businessDate: doc.documentDate,
        employeeId,
      });
    }
    await this.documents.markUnposted(trx, tenantId, doc.id, employeeId);
    await this.audit.append(trx, {
      action: 'document.unposted',
      entityType: 'document',
      entityId: doc.id,
      storeId: doc.storeId,
      details: { type: doc.type, number: doc.number, totalMinor: total },
    });
  }

  /** Batches of the document that moved after its posting (sales, other documents). */
  async blockers(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<UnpostCheck['blockers']> {
    const lines = await this.documents.lines(trx, tenantId, doc.type, doc.id);
    return this.blockersOf(trx, tenantId, doc, lines, false);
  }

  private async blockersOf(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
    lines: readonly LineRow[],
    lock: boolean,
  ): Promise<UnpostCheck['blockers']> {
    const batchIds = [
      ...new Set(lines.flatMap((l) => (l.batchId ? [l.batchId] : []))),
    ];
    if (lock) await this.documents.lockBatches(trx, tenantId, batchIds);
    const foreign = await this.documents.foreignMovements(
      trx,
      tenantId,
      batchIds,
      doc.id,
    );
    if (foreign.length === 0) return [];
    const products = await this.productMap(trx, tenantId, lines);
    return batchIds.flatMap((batchId) => {
      const moves = foreign.filter((m) => m.batchId === batchId);
      if (moves.length === 0) return [];
      const line = lines.find((l) => l.batchId === batchId) as LineRow;
      return [
        {
          productName: products.get(line.productId)?.name ?? '',
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

  private async productMap(
    trx: TenantTransaction,
    tenantId: string,
    lines: readonly LineRow[],
  ): Promise<Map<string, PricingProduct>> {
    const found = await this.products.findForPricing(trx, tenantId, [
      ...new Set(lines.map((l) => l.productId)),
    ]);
    return new Map(found.map((p) => [p.id, p]));
  }
}
