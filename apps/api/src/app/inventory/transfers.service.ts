import { Injectable, Logger } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  AcceptTransferRequest,
  Transfer,
  TransferInput,
  TransferOverview,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import { InventoryRepository } from './inventory.repository';
import { Numbering } from './numbering';
import { StockFreeze } from './stock-freeze';
import { StoreAccess } from './store-access';
import {
  type AfterAcceptance,
  TransferAcceptance,
} from './transfer-acceptance';
import { TransferMapper } from './transfer-mapper';
import { TransferPosting } from './transfer-posting';
import { TransfersRepository } from './transfers.repository';
import { WriteOffsRepository } from './write-offs.repository';

const DAY_MS = 86_400_000;
const OVERVIEW_DAYS = 30;
const OVERVIEW_LIMIT = 200;
const notFound = () => new ProblemException(404, 'not_found');
const badField = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

// Transfers between cloud stores (spec 2026-10-12-supplier-returns-transfers, 5.3–5.4): the sender
// drafts, sends, recalls or cancels; the receiver accepts. A transfer by a request takes only the
// request's products, not more than asked. Locks: the request first, then the transfer, then the
// stock of the store (StockFreeze), then the batches. Seen when either store is in the scope.
@Injectable()
export class TransfersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly documents: DocumentsRepository,
    private readonly lines: TransfersRepository,
    private readonly writeOffBatches: WriteOffsRepository,
    private readonly inventory: InventoryRepository,
    private readonly numbering: Numbering,
    private readonly products: ProductsReader,
    private readonly mapper: TransferMapper,
    private readonly posting: TransferPosting,
    private readonly audit: AuditService,
    private readonly stores: StoreAccess,
    private readonly freeze: StockFreeze,
    private readonly acceptance: TransferAcceptance,
  ) {}

  private readonly logger = new Logger(TransfersService.name);

  async overview(query: { storeId?: string }): Promise<TransferOverview> {
    const { tenantId } = requirePrincipal();
    const storeId = query.storeId?.toLowerCase();
    if (storeId) this.stores.inScope(storeId);
    const storeIds = storeId ? [storeId] : this.stores.scope();
    return this.db.tenantTransaction(async (trx) => {
      const today = (await this.inventory.settings(trx, tenantId)).today;
      const since = new Date(
        Date.parse(`${today}T00:00:00Z`) - OVERVIEW_DAYS * DAY_MS,
      )
        .toISOString()
        .slice(0, 10);
      const requestRows = await this.lines.overview(
        trx,
        tenantId,
        'transfer_request',
        storeIds,
        since,
        OVERVIEW_LIMIT,
        this.stores.scope(),
      );
      const transferRows = await this.lines.overview(
        trx,
        tenantId,
        'transfer',
        storeIds,
        since,
        OVERVIEW_LIMIT,
        this.stores.scope(),
      );
      const stores = await this.inventory.activeStores(trx, tenantId, null);
      return {
        requests: await this.mapper.requests(trx, tenantId, requestRows),
        transfers: await this.mapper.listItems(trx, tenantId, transferRows),
        kpi: await this.lines.overviewKpi(trx, tenantId, storeIds),
        stores: stores.map((s) => ({
          id: s.id,
          name: s.name,
          mode: s.mode === 'online' ? ('cloud' as const) : ('offline' as const),
        })),
      };
    });
  }

  async get(id: string): Promise<Transfer> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.mapper.transfer(
        trx,
        tenantId,
        await this.visible(trx, tenantId, id),
      ),
    );
  }

  /** A draft; `send` sends it at once (needs `inventory:post`). */
  async create(input: TransferInput): Promise<Transfer> {
    const { tenantId, employeeId } = requirePrincipal();
    if (input.send) this.requirePost();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      const request = input.requestId
        ? await this.lockedRequest(trx, tenantId, input.requestId)
        : null;
      const sender = await this.save(trx, tenantId, id, null, request, input);
      if (request) {
        await this.documents.setStatus(
          trx,
          tenantId,
          request.id,
          'in_progress',
        );
      }
      if (input.send) {
        await this.posting.send(
          trx,
          { tenantId, employeeId },
          await this.read(trx, tenantId, id),
          sender,
        );
      }
      return this.mapper.transfer(
        trx,
        tenantId,
        await this.read(trx, tenantId, id),
      );
    });
  }

  /** Only a draft: 409 `document_posted` / `document_cancelled`. */
  async update(id: string, input: TransferInput): Promise<Transfer> {
    const { tenantId, employeeId } = requirePrincipal();
    if (input.send) this.requirePost();
    return this.db.tenantTransaction(async (trx) => {
      const { doc, request } = await this.lockedWithRequest(trx, tenantId, id);
      this.draftOnly(doc);
      const sender = await this.save(
        trx,
        tenantId,
        doc.id,
        doc,
        request,
        input,
      );
      if (input.send) {
        await this.posting.send(
          trx,
          { tenantId, employeeId },
          await this.read(trx, tenantId, doc.id),
          sender,
        );
      }
      return this.mapper.transfer(
        trx,
        tenantId,
        await this.read(trx, tenantId, doc.id),
      );
    });
  }

  async send(id: string): Promise<Transfer> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const { doc } = await this.lockedWithRequest(trx, tenantId, id);
      this.draftOnly(doc);
      const sender = await this.stores.writableStore(
        trx,
        tenantId,
        doc.storeId,
      );
      await this.stores.counterpartStore(
        trx,
        tenantId,
        doc.destinationStoreId as string,
        'toStoreId',
        true,
      );
      await this.posting.send(trx, { tenantId, employeeId }, doc, sender);
      return this.mapper.transfer(
        trx,
        tenantId,
        await this.read(trx, tenantId, doc.id),
      );
    });
  }

  /**
   * 409 `transfer_not_in_transit`; 409 `offline_transfer_no_recall` when either store is an offline one
   * (spec 2026-10-16-offline-sync, E34: its side may already have accepted it — a wrong transfer is
   * corrected by a transfer back).
   */
  async recall(id: string): Promise<Transfer> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const { doc } = await this.lockedWithRequest(trx, tenantId, id);
      if (doc.status !== 'in_transit') {
        throw new ProblemException(409, 'transfer_not_in_transit');
      }
      const [from, to] = [
        await this.stores.counterpartStore(
          trx,
          tenantId,
          doc.storeId,
          'fromStoreId',
          true,
        ),
        await this.stores.counterpartStore(
          trx,
          tenantId,
          doc.destinationStoreId as string,
          'toStoreId',
          true,
        ),
      ];
      if (from.mode !== 'online' || to.mode !== 'online') {
        throw new ProblemException(409, 'offline_transfer_no_recall');
      }
      const sender = await this.stores.writableStore(
        trx,
        tenantId,
        doc.storeId,
      );
      await this.posting.recall(trx, { tenantId, employeeId }, doc, sender);
      return this.mapper.transfer(
        trx,
        tenantId,
        await this.read(trx, tenantId, doc.id),
      );
    });
  }

  /** A draft → `cancelled` (E3); its request is `sent` again. */
  async cancel(id: string): Promise<Transfer> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const { doc, request } = await this.lockedWithRequest(trx, tenantId, id);
      this.draftOnly(doc);
      await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.documents.markCancelled(trx, tenantId, doc.id, employeeId);
      if (request) {
        await this.documents.setStatus(trx, tenantId, request.id, 'sent');
      }
      await this.audit.append(trx, {
        action: 'transfer.cancelled',
        entityType: 'document',
        entityId: doc.id,
        storeId: doc.storeId,
        details: { number: doc.number },
      });
      return this.mapper.transfer(
        trx,
        tenantId,
        await this.read(trx, tenantId, doc.id),
      );
    });
  }

  /**
   * The receiver: 403 out of its scope, 409 `transfer_not_in_transit`; 409 `transfer_changed` when
   * the transfer was sent again (recalled and changed) since the card was read.
   */
  async accept(id: string, body: AcceptTransferRequest): Promise<Transfer> {
    const { tenantId, employeeId } = requirePrincipal();
    let after: AfterAcceptance[] = [];
    const accepted = await this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id, true);
      const receiver = await this.stores.writableStore(
        trx,
        tenantId,
        doc.destinationStoreId as string,
      );
      if (doc.status !== 'in_transit') {
        throw new ProblemException(409, 'transfer_not_in_transit');
      }
      // the quantities were filled for this dispatch, not an earlier one (milliseconds: the
      // precision of the card)
      if (
        doc.dispatchedAt === null ||
        doc.dispatchedAt.getTime() !== Date.parse(body.dispatchedAt)
      ) {
        throw new ProblemException(409, 'transfer_changed');
      }
      await this.posting.accept(
        trx,
        { tenantId, employeeId },
        doc,
        receiver,
        body,
      );
      // e.g. the store whose closing this transfer ends is closed (spec 2026-10-15-store-closing, E11)
      after = await this.acceptance.notify(trx, tenantId, doc.id);
      return this.mapper.transfer(
        trx,
        tenantId,
        await this.read(trx, tenantId, doc.id),
      );
    });
    // after the commit; a failure is logged, the acceptance stands
    for (const work of after) {
      try {
        await work();
      } catch (error) {
        this.logger.error(
          `Work after the acceptance of transfer ${id} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return accepted;
  }

  /* ---------------- helpers ---------------- */

  private requirePost(): void {
    if (!hasPermissions(requirePrincipal().permissions, 'inventory:post')) {
      throw new ProblemException(403, 'forbidden');
    }
  }

  private draftOnly(doc: DocumentRow): void {
    if (doc.status === 'cancelled') {
      throw new ProblemException(409, 'document_cancelled');
    }
    if (doc.status !== 'draft') {
      throw new ProblemException(409, 'document_posted');
    }
  }

  /** Either store in the scope; else 404. */
  private async visible(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<DocumentRow> {
    const doc = await this.documents.findDocument(
      trx,
      tenantId,
      'transfer',
      id.toLowerCase(),
      lock,
    );
    const scope = this.stores.scope();
    if (
      doc === null ||
      (scope !== null &&
        !scope.includes(doc.storeId) &&
        !scope.includes(doc.destinationStoreId as string))
    ) {
      throw notFound();
    }
    return doc;
  }

  /** The transfer locked after its request (the order of every write of a transfer). */
  private async lockedWithRequest(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<{ doc: DocumentRow; request: DocumentRow | null }> {
    const peek = await this.visible(trx, tenantId, id);
    const request = peek.requestDocumentId
      ? await this.documents.findDocument(
          trx,
          tenantId,
          'transfer_request',
          peek.requestDocumentId,
          true,
        )
      : null;
    const doc = await this.visible(trx, tenantId, peek.id, true);
    return { doc, request };
  }

  /** A sent request to be picked, locked: 409 `request_not_open` / `request_has_transfer`. */
  async lockedRequest(
    trx: TenantTransaction,
    tenantId: string,
    requestId: string,
  ): Promise<DocumentRow> {
    const request = await this.documents.findDocument(
      trx,
      tenantId,
      'transfer_request',
      requestId.toLowerCase(),
      true,
    );
    if (request === null || request.status !== 'sent') {
      throw new ProblemException(409, 'request_not_open');
    }
    if (
      (await this.lines.transfersOfRequests(trx, tenantId, [request.id])).has(
        request.id,
      )
    ) {
      throw new ProblemException(409, 'request_has_transfer');
    }
    return request;
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<DocumentRow> {
    const doc = await this.documents.findDocument(
      trx,
      tenantId,
      'transfer',
      id,
    );
    if (doc === null)
      throw new Error('The document just written is not readable');
    return doc;
  }

  /** The header and the lines of a draft; returns the sender. */
  private async save(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    current: DocumentRow | null,
    request: DocumentRow | null,
    input: TransferInput,
  ) {
    const { employeeId } = requirePrincipal();
    const fromStoreId = input.fromStoreId.toLowerCase();
    const toStoreId = input.toStoreId.toLowerCase();
    if (current !== null && current.storeId !== fromStoreId) {
      throw badField('fromStoreId', 'immutable');
    }
    const requestId = input.requestId?.toLowerCase() ?? null;
    if (current !== null && current.requestDocumentId !== requestId) {
      throw badField('requestId', 'immutable');
    }
    const sender = await this.stores.writableStore(trx, tenantId, fromStoreId);
    if (toStoreId === fromStoreId) throw badField('toStoreId', 'same_store');
    await this.stores.counterpartStore(
      trx,
      tenantId,
      toStoreId,
      'toStoreId',
      true,
    );
    if (
      request !== null &&
      (request.destinationStoreId !== fromStoreId ||
        request.storeId !== toStoreId)
    ) {
      throw new ProblemException(409, 'request_not_open');
    }
    // the batches of the sender; by a request — its products, not more than asked
    const batchIds = input.lines.map((l) => l.batchId.toLowerCase());
    const batches = await this.writeOffBatches.batches(trx, tenantId, batchIds);
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(input.lines.map((l) => l.productId.toLowerCase())),
        ])
      ).map((p) => [p.id, p]),
    );
    const asked = request
      ? new Map(
          (
            (await this.lines.requestLines(trx, tenantId, [request.id])).get(
              request.id,
            ) ?? []
          ).map((l) => [l.productId, l.qtyRequestedPieces]),
        )
      : null;
    const sent = new Map<string, number>();
    const seen = new Set<string>();
    const values = input.lines.map((line, i) => {
      const batch = batches.get(batchIds[i]);
      const product = products.get(line.productId.toLowerCase());
      if (
        !batch ||
        !product ||
        batch.storeId !== fromStoreId ||
        batch.productId !== product.id
      ) {
        throw badField(`lines.${i}.batchId`, 'unknown_batch');
      }
      if (seen.has(batch.id)) throw badField(`lines.${i}.batchId`, 'duplicate');
      seen.add(batch.id);
      if (line.unit === 'piece' && !product.divisible) {
        throw badField(`lines.${i}.unit`, 'not_divisible');
      }
      const qtySentPieces =
        line.unit === 'piece'
          ? line.quantity
          : line.quantity * product.piecesPerPack;
      if (asked !== null) {
        const limit = asked.get(product.id);
        if (limit === undefined) {
          throw badField(`lines.${i}.productId`, 'not_requested');
        }
        const total = (sent.get(product.id) ?? 0) + qtySentPieces;
        sent.set(product.id, total);
        if (total > limit)
          throw badField(`lines.${i}.quantity`, 'exceeds_request');
      }
      return {
        sourceBatchId: batch.id,
        productId: product.id,
        unit: line.unit,
        qtySentPieces,
      };
    });
    const today = (await this.inventory.settings(trx, tenantId)).today;
    const header = {
      storeId: fromStoreId,
      documentDate: current?.documentDate ?? today,
      comment: null,
      totalDirams: 0,
      supplierId: null,
      supplierInvoiceNumber: null,
      paymentDueDate: null,
      purchaseOrderId: null,
      destinationStoreId: toStoreId,
      requestDocumentId: requestId,
    };
    if (current === null) {
      const number = await this.numbering.next(
        trx,
        tenantId,
        sender,
        'transfer',
        today,
      );
      await this.documents.insertDocument(
        trx,
        tenantId,
        id,
        'transfer',
        number,
        employeeId,
        header,
      );
    } else {
      await this.documents.updateHeader(trx, tenantId, id, header);
    }
    // Sent at once: the stock of the store, then the batches — the order of the sending — are
    // locked before the lines reference the batches. A reference takes a key-share lock, and two
    // sends of a common batch that each held one and then asked for update would deadlock. After
    // the document counter: a draft of the store, which takes the counter first, waits for it.
    if (input.send) {
      await this.freeze.lockShared(trx, tenantId, fromStoreId);
      await this.documents.lockBatches(
        trx,
        tenantId,
        values.map((v) => v.sourceBatchId),
      );
    }
    await this.lines.replaceTransferLines(trx, tenantId, id, values);
    await this.audit.append(trx, {
      action: current === null ? 'document.created' : 'document.updated',
      entityType: 'document',
      entityId: id,
      storeId: fromStoreId,
      details: {
        type: 'transfer',
        toStoreId,
        requestId,
        lines: values.length,
      },
    });
    return sender;
  }
}
