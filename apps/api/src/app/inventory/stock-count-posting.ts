import { Injectable } from '@nestjs/common';
import type { UnpostCheck } from '@pharmacy/shared-dto';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { newId, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import {
  InventoryRepository,
  type StoreForWrite,
} from './inventory.repository';
import { checkDocumentDate } from './posting';
import { StockCountsRepository } from './stock-counts.repository';
import { StockFreeze } from './stock-freeze';
import { StockRepository } from './stock.repository';

// Posting and unposting of a stock count (spec 2026-10-12-write-offs-stock-counts, section 5.2) in
// the caller's transaction: every line counted, the difference against the current stock of the
// batch (the book stock minus the POS since the start — the other documents are frozen) goes in as
// `inventory_gain` / `inventory_loss`, a found product gets an `inventory_surplus` batch. Only the
// closed period is checked (B3); unposting is blocked by movements of the moved batches after the
// posting (B2).
@Injectable()
export class StockCountPosting {
  constructor(
    private readonly documents: DocumentsRepository,
    private readonly counts: StockCountsRepository,
    private readonly inventory: InventoryRepository,
    private readonly stock: StockRepository,
    private readonly products: ProductsReader,
    private readonly freeze: StockFreeze,
    private readonly audit: AuditService,
  ) {}

  async post(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    store: StoreForWrite,
  ): Promise<void> {
    const { tenantId, employeeId } = ctx;
    if (doc.status === 'posted')
      throw new ProblemException(409, 'document_posted');
    if (doc.status === 'cancelled')
      throw new ProblemException(409, 'document_cancelled');
    await this.freeze.lockExclusive(trx, tenantId, doc.storeId);
    checkDocumentDate(
      await this.inventory.settings(trx, tenantId),
      store,
      doc.documentDate,
      { backdating: false },
    );
    const lines = await this.counts.lines(trx, tenantId, doc.id);
    const entries = await this.counts.entries(trx, tenantId, doc.id);
    const facts = new Map<string, number>();
    for (const entry of entries) {
      facts.set(entry.lineId, (facts.get(entry.lineId) ?? 0) + entry.qtyPieces);
    }
    const problems = lines.flatMap((line, i) => [
      ...(!facts.has(line.id)
        ? [{ field: `lines.${i}.counted`, code: 'required' }]
        : (facts.get(line.id) ?? 0) < 0
          ? [{ field: `lines.${i}.counted`, code: 'negative' }]
          : []),
      ...(line.isFound && line.surplusExpiryDate === null
        ? [{ field: `lines.${i}.expiresOn`, code: 'required' }]
        : []),
      ...(line.isFound && line.surplusPurchasePricePerPackDirams === null
        ? [{ field: `lines.${i}.costMinor`, code: 'required' }]
        : []),
    ]);
    if (problems.length > 0) {
      throw new FieldProblemException(422, 'validation_failed', problems);
    }

    // lock, then count (ADR-0006); the expected stock of a line is the stock of its batch at the
    // first entry (spec 2026-10-13-pos-shift-sale, K2): what the POS sold after it was counted
    const batchIds = lines.flatMap((l) => (l.batchId ? [l.batchId] : []));
    await this.documents.lockBatches(trx, tenantId, batchIds);
    const current = await this.stock.stockOfBatches(
      trx,
      tenantId,
      doc.storeId,
      batchIds,
    );
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const movements: Parameters<
      DocumentsRepository['insertMovements']
    >[2][number][] = [];
    let total = 0;
    let surplus = 0;
    let shortage = 0;
    for (const line of lines) {
      const fact = facts.get(line.id) ?? 0;
      if (line.isFound) {
        let batchId = line.surplusBatchId;
        const price = Number(line.surplusPurchasePricePerPackDirams ?? 0n);
        if (fact > 0 && batchId !== null) {
          // a repost after an unposting: the batch was reversed to zero and did not move since
          // (else the unposting is blocked), so it takes the expiry, lot and price edited meanwhile
          const ppp = products.get(line.productId)?.piecesPerPack ?? 1;
          await this.counts.refreshSurplusBatch(trx, tenantId, batchId, {
            lotNumber: line.surplusLotNumber,
            expiryDate: line.surplusExpiryDate as string,
            purchasePricePerPackDirams: price,
            costPerPieceDirams: Math.ceil(price / ppp),
          });
        }
        if (fact > 0 && batchId === null) {
          // a new batch of the found product; the cost of a piece is rounded up (ТЗ)
          const ppp = products.get(line.productId)?.piecesPerPack ?? 1;
          batchId = newId();
          await this.documents.insertBatch(trx, tenantId, {
            id: batchId,
            storeId: doc.storeId,
            productId: line.productId,
            expiryDate: line.surplusExpiryDate as string,
            lotNumber: line.surplusLotNumber,
            purchasePricePerPackDirams: price,
            costPerPieceDirams: Math.ceil(price / ppp),
            supplierId: null,
            origin: 'inventory_surplus',
            sourceDocumentId: doc.id,
            isStarting: false,
          });
        }
        if (fact > 0 && batchId !== null) {
          const ppp = products.get(line.productId)?.piecesPerPack ?? 1;
          movements.push({
            storeId: doc.storeId,
            batchId,
            qtyDeltaPieces: fact,
            kind: 'inventory_gain',
            sourceId: doc.id,
            sourceLineId: line.id,
            businessDate: doc.documentDate,
            reversesMovementId: null,
          });
          total +=
            fact *
            Math.ceil(
              Number(line.surplusPurchasePricePerPackDirams ?? 0n) / ppp,
            );
          surplus += 1;
        }
        await this.counts.setLineResult(trx, tenantId, line.id, {
          countedQtyPieces: fact,
          soldSinceStartPieces: 0,
          ...(batchId ? { surplusBatchId: batchId } : {}),
        });
        continue;
      }
      const now = current.get(line.batchId as string) ?? 0;
      const expected = line.stockAtFirstEntryPieces ?? now;
      const diff = fact - expected;
      if (diff !== 0) {
        movements.push({
          storeId: doc.storeId,
          batchId: line.batchId as string,
          qtyDeltaPieces: diff,
          kind: diff > 0 ? 'inventory_gain' : 'inventory_loss',
          sourceId: doc.id,
          sourceLineId: line.id,
          businessDate: doc.documentDate,
          reversesMovementId: null,
        });
        total += Math.abs(diff) * Number(line.costPerPieceDirams ?? 0n);
        if (diff > 0) surplus += 1;
        else shortage += 1;
      }
      await this.counts.setLineResult(trx, tenantId, line.id, {
        countedQtyPieces: fact,
        soldSinceStartPieces: line.bookQtyPieces - expected,
        soldAfterCountPieces: expected - now,
      });
    }
    await this.documents.insertMovements(trx, tenantId, movements);
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
        surplusLines: surplus,
        shortageLines: shortage,
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
    await this.freeze.lockExclusive(trx, tenantId, doc.storeId);
    checkDocumentDate(
      await this.inventory.settings(trx, tenantId),
      store,
      doc.documentDate,
      { backdating: false },
    );
    // the count becomes running again: no other count of the store may run (S5)
    const other = await this.counts.running(trx, tenantId, doc.storeId);
    if (other !== null && other !== doc.id) {
      throw new ProblemException(409, 'stock_count_in_progress');
    }
    if ((await this.blockersOf(trx, tenantId, doc, true)).length > 0) {
      throw new ProblemException(409, 'unpost_blocked');
    }
    await this.documents.reverseMovements(
      trx,
      tenantId,
      doc.id,
      doc.documentDate,
    );
    await this.documents.markUnposted(trx, tenantId, doc.id, employeeId);
    await this.audit.append(trx, {
      action: 'document.unposted',
      entityType: 'document',
      entityId: doc.id,
      storeId: doc.storeId,
      details: {
        type: doc.type,
        number: doc.number,
        totalMinor: Number(doc.totalDirams ?? 0n),
      },
    });
  }

  /** Batches the count moved (differences and surplus batches) that moved after its posting. */
  async blockers(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<UnpostCheck['blockers']> {
    return this.blockersOf(trx, tenantId, doc, false);
  }

  private async blockersOf(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
    lock: boolean,
  ): Promise<UnpostCheck['blockers']> {
    if (doc.postedAt === null) return [];
    // Only the live movements of the current posting: batches of an earlier posting (already
    // reversed) do not block undoing this one (B2).
    const own = await this.documents.documentMovements(trx, tenantId, doc.id);
    const reversed = new Set(
      own.flatMap((m) => (m.reversesMovementId ? [m.reversesMovementId] : [])),
    );
    const batchIds = [
      ...new Set(
        own
          .filter((m) => m.kind !== 'reversal' && !reversed.has(m.id))
          .map((m) => m.batchId),
      ),
    ];
    if (lock) await this.documents.lockBatches(trx, tenantId, batchIds);
    const foreign = await this.documents.foreignMovements(
      trx,
      tenantId,
      batchIds,
      doc.id,
      doc.postedAt,
    );
    if (foreign.length === 0) return [];
    const lines = await this.counts.lines(trx, tenantId, doc.id);
    const names = new Map(
      (
        await this.products.findForPricing(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p.name]),
    );
    return batchIds.flatMap((batchId) => {
      const moves = foreign.filter((m) => m.batchId === batchId);
      const line = lines.find(
        (l) => l.batchId === batchId || l.surplusBatchId === batchId,
      );
      if (moves.length === 0) return [];
      // A moved batch without its line still blocks (fail closed), only unnamed.
      return [
        {
          productName: line ? (names.get(line.productId) ?? '') : '',
          batchNumber: line?.lotNumber ?? '',
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
