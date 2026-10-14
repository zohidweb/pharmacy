import { Injectable } from '@nestjs/common';
import type { AcceptTransferRequest } from '@pharmacy/shared-dto';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { newId, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { StorePriceWriter } from '../pricing/store-price-writer';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import {
  InventoryRepository,
  type StoreForWrite,
} from './inventory.repository';
import { Numbering } from './numbering';
import { checkDocumentDate } from './posting';
import { StockFreeze } from './stock-freeze';
import { StockRepository } from './stock.repository';
import {
  type TransferLineRow,
  TransfersRepository,
} from './transfers.repository';
import { WriteOffsRepository } from './write-offs.repository';

const pieces = (
  line: Pick<TransferLineRow, 'unit' | 'piecesPerPack'>,
  q: number,
) => (line.unit === 'piece' ? q : q * line.piecesPerPack);

// Sending, recall and acceptance of a transfer (spec 2026-10-12-supplier-returns-transfers, 5.3):
// the sender's stock goes down at the dispatch and comes back at a recall; the receiver gets its
// own batches only at the acceptance; a shortage is written off at the sender by the system (T6),
// its stock unchanged (+N by a partial reversal of the dispatch, −N by the write-off). Runs in the
// transaction of the caller, after the request (if any) and the transfer are locked.
@Injectable()
export class TransferPosting {
  constructor(
    private readonly documents: DocumentsRepository,
    private readonly lines: TransfersRepository,
    private readonly writeOffs: WriteOffsRepository,
    private readonly inventory: InventoryRepository,
    private readonly stock: StockRepository,
    private readonly numbering: Numbering,
    private readonly freeze: StockFreeze,
    private readonly prices: StorePriceWriter,
    private readonly audit: AuditService,
  ) {}

  /** `draft` → `in_transit`; the request closes — done or partial. */
  async send(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    sender: StoreForWrite,
  ): Promise<void> {
    const { tenantId, employeeId } = ctx;
    const lines = await this.lines.transferLines(trx, tenantId, doc.id);
    if (lines.length === 0) {
      throw new FieldProblemException(422, 'validation_failed', [
        { field: 'lines', code: 'required' },
      ]);
    }
    await this.freeze.guard(
      trx,
      tenantId,
      sender.id,
      lines.map((l) => l.productId),
    );
    // dated by the day of the dispatch, no backdating (E4)
    const settings = await this.inventory.settings(trx, tenantId);
    checkDocumentDate(settings, sender, settings.today, { backdating: false });
    const batchIds = lines.map((l) => l.sourceBatchId);
    await this.documents.lockBatches(trx, tenantId, batchIds);
    const stock = await this.stock.stockOfBatches(
      trx,
      tenantId,
      sender.id,
      batchIds,
    );
    const short = lines.flatMap((line, i) =>
      line.qtySentPieces > (stock.get(line.sourceBatchId) ?? 0)
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
        storeId: sender.id,
        batchId: line.sourceBatchId,
        qtyDeltaPieces: -line.qtySentPieces,
        kind: 'transfer_out',
        sourceId: doc.id,
        sourceLineId: line.id,
        businessDate: settings.today,
        reversesMovementId: null,
      })),
    );
    await this.documents.markDispatched(
      trx,
      tenantId,
      doc.id,
      employeeId,
      settings.today,
    );
    if (doc.requestDocumentId) {
      const asked =
        (
          await this.lines.requestLines(trx, tenantId, [doc.requestDocumentId])
        ).get(doc.requestDocumentId) ?? [];
      const full = asked.every(
        (a) =>
          lines
            .filter((l) => l.productId === a.productId)
            .reduce((sum, l) => sum + l.qtySentPieces, 0) >=
          a.qtyRequestedPieces,
      );
      await this.documents.setStatus(
        trx,
        tenantId,
        doc.requestDocumentId,
        full ? 'done' : 'partial',
      );
    }
    await this.audit.append(trx, {
      action: 'transfer.dispatched',
      entityType: 'document',
      entityId: doc.id,
      storeId: sender.id,
      details: {
        number: doc.number,
        toStoreId: doc.destinationStoreId,
        lines: lines.length,
      },
    });
  }

  /** `in_transit` → `draft`: the dispatch is reversed, the request is in progress again. */
  async recall(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    sender: StoreForWrite,
  ): Promise<void> {
    const { tenantId } = ctx;
    const lines = await this.lines.transferLines(trx, tenantId, doc.id);
    await this.freeze.guard(
      trx,
      tenantId,
      sender.id,
      lines.map((l) => l.productId),
    );
    // the reversal is dated by the document: a closed period stays closed
    checkDocumentDate(
      await this.inventory.settings(trx, tenantId),
      sender,
      doc.documentDate,
      { backdating: false },
    );
    await this.documents.reverseMovements(
      trx,
      tenantId,
      doc.id,
      doc.documentDate,
    );
    await this.documents.markRecalled(trx, tenantId, doc.id);
    if (doc.requestDocumentId) {
      await this.documents.setStatus(
        trx,
        tenantId,
        doc.requestDocumentId,
        'in_progress',
      );
    }
    await this.audit.append(trx, {
      action: 'transfer.recalled',
      entityType: 'document',
      entityId: doc.id,
      storeId: sender.id,
      details: { number: doc.number },
    });
  }

  /**
   * `in_transit` → `received`: every line once, 0…sent in its unit; the receiver's batches and
   * prices, then the write-off of the shortage at the sender.
   */
  async accept(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    receiver: StoreForWrite,
    body: AcceptTransferRequest,
  ): Promise<void> {
    const { tenantId, employeeId } = ctx;
    const lines = await this.lines.transferLines(trx, tenantId, doc.id);
    const given = new Map<string, number>();
    for (const line of body.lines) {
      const batchId = line.batchId.toLowerCase();
      if (given.has(batchId)) {
        throw new FieldProblemException(400, 'validation_failed', [
          { field: 'lines', code: 'duplicate' },
        ]);
      }
      given.set(batchId, line.receivedQuantity);
    }
    if (
      given.size !== lines.length ||
      lines.some((l) => !given.has(l.sourceBatchId))
    ) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'lines', code: 'every_line_once' },
      ]);
    }
    const received = lines.map((line, i) => {
      const value = pieces(line, given.get(line.sourceBatchId) ?? 0);
      if (value > line.qtySentPieces) {
        throw new FieldProblemException(400, 'validation_failed', [
          { field: `lines.${i}.receivedQuantity`, code: 'over_sent' },
        ]);
      }
      return value;
    });
    await this.freeze.guard(
      trx,
      tenantId,
      receiver.id,
      lines.filter((_, i) => received[i] > 0).map((l) => l.productId),
    );
    const settings = await this.inventory.settings(trx, tenantId);
    checkDocumentDate(settings, receiver, settings.today, {
      backdating: false,
    });
    const today = settings.today;
    const short = lines
      .map((line, i) => ({ line, missing: line.qtySentPieces - received[i] }))
      .filter((s) => s.missing > 0);
    // The sender's batches of the shortage are locked for update before the receiver's batches
    // reference them (a key-share lock): two acceptances of a common batch then wait instead of
    // deadlocking.
    await this.documents.lockBatches(
      trx,
      tenantId,
      short.map((s) => s.line.sourceBatchId),
    );

    // the receiver's batches: the values of the sender's batch (D2)
    const arrivals: Parameters<
      DocumentsRepository['insertMovements']
    >[2][number][] = [];
    for (const [i, line] of lines.entries()) {
      let target: string | null = null;
      if (received[i] > 0) {
        target = newId();
        await this.documents.insertBatch(trx, tenantId, {
          id: target,
          storeId: receiver.id,
          productId: line.productId,
          expiryDate: line.expiryDate,
          lotNumber: line.lotNumber,
          purchasePricePerPackDirams: Number(line.purchasePricePerPackDirams),
          costPerPieceDirams: Number(line.costPerPieceDirams),
          supplierId: line.supplierId,
          origin: 'transfer',
          sourceDocumentId: doc.id,
          isStarting: false,
          sourceBatchId: line.sourceBatchId,
        });
        arrivals.push({
          storeId: receiver.id,
          batchId: target,
          qtyDeltaPieces: received[i],
          kind: 'transfer_in',
          sourceId: doc.id,
          sourceLineId: line.id,
          businessDate: today,
          reversesMovementId: null,
        });
      }
      await this.lines.setReceived(trx, tenantId, line.id, received[i], target);
    }
    await this.documents.insertMovements(trx, tenantId, arrivals);
    // a product without a price at the receiver takes the sender's (T10)
    await this.prices.copyIfMissing(trx, {
      tenantId,
      productIds: [
        ...new Set(
          lines.filter((_, i) => received[i] > 0).map((l) => l.productId),
        ),
      ],
      fromStoreId: doc.storeId,
      toStoreId: receiver.id,
      documentId: doc.id,
    });

    if (short.length > 0) {
      await this.writeOffShortage(trx, ctx, doc, short, body.comment, today);
    }
    await this.documents.markReceived(
      trx,
      tenantId,
      doc.id,
      employeeId,
      body.comment.trim() || null,
    );
    await this.audit.append(trx, {
      action: 'transfer.received',
      entityType: 'document',
      entityId: doc.id,
      storeId: receiver.id,
      details: {
        number: doc.number,
        lines: lines.length,
        shortLines: short.length,
      },
    });
  }

  /**
   * The shortage, written off at the sender (T6): the dispatch of the missing pieces is reversed
   * (+N) and a posted write-off `transfer_discrepancy` takes them (−N) — the sender's stock does
   * not change, the loss is a write-off as any other. The batches of the shortage are locked by
   * `accept`.
   */
  private async writeOffShortage(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    doc: DocumentRow,
    short: ReadonlyArray<{ line: TransferLineRow; missing: number }>,
    comment: string,
    today: string,
  ): Promise<void> {
    const { tenantId, employeeId } = ctx;
    const sender = await this.inventory.store(trx, tenantId, doc.storeId);
    if (sender === null) throw new ProblemException(404, 'not_found');
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
      short.map(({ line, missing }) => {
        const dispatch = movements
          .filter(
            (m) =>
              m.kind === 'transfer_out' &&
              m.sourceLineId === line.id &&
              !reversed.has(m.id),
          )
          .at(-1);
        return {
          storeId: doc.storeId,
          batchId: line.sourceBatchId,
          qtyDeltaPieces: missing,
          kind: 'reversal',
          sourceId: doc.id,
          sourceLineId: line.id,
          businessDate: today,
          reversesMovementId: dispatch?.id ?? null,
        };
      }),
    );
    const writeOffId = newId();
    const number = await this.numbering.next(
      trx,
      tenantId,
      sender,
      'write_off',
      today,
    );
    const total = short.reduce(
      (sum, s) => sum + s.missing * Number(s.line.costPerPieceDirams),
      0,
    );
    await this.documents.insertDocument(
      trx,
      tenantId,
      writeOffId,
      'write_off',
      number,
      employeeId,
      {
        storeId: doc.storeId,
        documentDate: today,
        comment: (comment.trim()
          ? `${doc.number}: ${comment.trim()}`
          : doc.number
        ).slice(0, 500),
        totalDirams: total,
        supplierId: null,
        supplierInvoiceNumber: null,
        paymentDueDate: null,
        purchaseOrderId: null,
        writeOffReason: 'transfer_discrepancy',
        sourceDocumentId: doc.id,
      },
    );
    await this.writeOffs.replaceLines(
      trx,
      tenantId,
      writeOffId,
      short.map(({ line, missing }) => ({
        batchId: line.sourceBatchId,
        productId: line.productId,
        qtyPieces: missing,
        unit: line.unit,
      })),
    );
    const written = await this.writeOffs.lines(trx, tenantId, writeOffId);
    await this.documents.insertMovements(
      trx,
      tenantId,
      written.map((line) => ({
        storeId: doc.storeId,
        batchId: line.batchId,
        qtyDeltaPieces: -line.qtyPieces,
        kind: 'write_off',
        sourceId: writeOffId,
        sourceLineId: line.id,
        businessDate: today,
        reversesMovementId: null,
      })),
    );
    await this.documents.markPosted(
      trx,
      tenantId,
      writeOffId,
      employeeId,
      total,
    );
    await this.audit.append(trx, {
      action: 'document.posted',
      entityType: 'document',
      entityId: writeOffId,
      storeId: doc.storeId,
      details: {
        type: 'write_off',
        number,
        reason: 'transfer_discrepancy',
        transfer: doc.number,
        lines: written.length,
        totalMinor: total,
      },
    });
  }
}
