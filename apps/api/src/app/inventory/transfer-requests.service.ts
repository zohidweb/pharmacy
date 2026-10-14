import { Injectable } from '@nestjs/common';
import type {
  RejectTransferRequest,
  TransferRequest,
  TransferRequestInput,
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
import { StoreAccess } from './store-access';
import { TransferMapper } from './transfer-mapper';
import { TransfersRepository } from './transfers.repository';

const notFound = () => new ProblemException(404, 'not_found');
const badField = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

// Transfer requests (spec 2026-10-12-supplier-returns-transfers, 5.2): the store that needs goods
// drafts, sends or deletes a request to another store; the asked store rejects it or makes its
// one transfer (TransfersService). A request is seen when either store is in the scope.
@Injectable()
export class TransferRequestsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly documents: DocumentsRepository,
    private readonly lines: TransfersRepository,
    private readonly inventory: InventoryRepository,
    private readonly numbering: Numbering,
    private readonly products: ProductsReader,
    private readonly mapper: TransferMapper,
    private readonly audit: AuditService,
    private readonly stores: StoreAccess,
  ) {}

  async get(id: string): Promise<TransferRequest> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.toDto(trx, tenantId, await this.visible(trx, tenantId, id)),
    );
  }

  async create(input: TransferRequestInput): Promise<TransferRequest> {
    const { tenantId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      await this.save(trx, tenantId, id, null, input);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, id));
    });
  }

  /** Only a draft: 409 `document_posted`. */
  async update(
    id: string,
    input: TransferRequestInput,
  ): Promise<TransferRequest> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, id);
      await this.save(trx, tenantId, doc.id, doc, input);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  /** A draft nothing refers to (E3). */
  async remove(id: string): Promise<void> {
    const { tenantId } = requirePrincipal();
    await this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, id);
      await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.documents.deleteDocument(
        trx,
        tenantId,
        'transfer_request',
        doc.id,
      );
      await this.audit.append(trx, {
        action: 'document.deleted',
        entityType: 'document',
        entityId: doc.id,
        storeId: doc.storeId,
        details: { type: doc.type, number: doc.number },
      });
    });
  }

  async send(id: string): Promise<TransferRequest> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, id);
      await this.stores.writableStore(trx, tenantId, doc.storeId);
      // checked at saving, but the store asked may have been closed or gone offline since
      await this.stores.counterpartStore(
        trx,
        tenantId,
        doc.destinationStoreId as string,
        'fromStoreId',
      );
      await this.documents.setStatus(trx, tenantId, doc.id, 'sent');
      await this.sentAudit(trx, doc);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  /**
   * The asked store rejects a sent request, or one in progress whose transfer is still a draft
   * (cancelled with it). 409 `request_not_open`; `comment` required for `other`.
   */
  async reject(
    id: string,
    body: RejectTransferRequest,
  ): Promise<TransferRequest> {
    const { tenantId, employeeId } = requirePrincipal();
    if (body.reason === 'other' && !body.comment.trim()) {
      throw badField('comment', 'required');
    }
    return this.db.tenantTransaction(async (trx) => {
      // the request first, then its transfer (the order of the transfer sending)
      const doc = await this.visible(trx, tenantId, id, true);
      await this.stores.writableStore(
        trx,
        tenantId,
        doc.destinationStoreId as string,
      );
      if (doc.status !== 'sent' && doc.status !== 'in_progress') {
        throw new ProblemException(409, 'request_not_open');
      }
      const linked = (
        await this.lines.transfersOfRequests(trx, tenantId, [doc.id])
      ).get(doc.id);
      if (linked) {
        const transfer = await this.documents.findDocument(
          trx,
          tenantId,
          'transfer',
          linked.id,
          true,
        );
        if (transfer === null || transfer.status !== 'draft') {
          throw new ProblemException(409, 'request_not_open');
        }
        await this.documents.markCancelled(
          trx,
          tenantId,
          transfer.id,
          employeeId,
        );
        await this.audit.append(trx, {
          action: 'transfer.cancelled',
          entityType: 'document',
          entityId: transfer.id,
          storeId: transfer.storeId,
          details: { number: transfer.number, byRejectionOf: doc.number },
        });
      }
      await this.documents.markRejected(
        trx,
        tenantId,
        doc.id,
        body.reason,
        body.comment.trim() || null,
      );
      await this.audit.append(trx, {
        action: 'transfer_request.rejected',
        entityType: 'document',
        entityId: doc.id,
        storeId: doc.destinationStoreId ?? undefined,
        details: { number: doc.number, reason: body.reason },
      });
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  /* ---------------- helpers ---------------- */

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
      'transfer_request',
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

  private async lockedDraft(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<DocumentRow> {
    const doc = await this.visible(trx, tenantId, id, true);
    if (doc.status !== 'draft')
      throw new ProblemException(409, 'document_posted');
    return doc;
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<DocumentRow> {
    const doc = await this.documents.findDocument(
      trx,
      tenantId,
      'transfer_request',
      id,
    );
    if (doc === null)
      throw new Error('The document just written is not readable');
    return doc;
  }

  private async save(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    current: DocumentRow | null,
    input: TransferRequestInput,
  ): Promise<void> {
    const { employeeId } = requirePrincipal();
    const storeId = input.toStoreId.toLowerCase();
    const fromStoreId = input.fromStoreId.toLowerCase();
    if (current !== null && current.storeId !== storeId) {
      throw badField('toStoreId', 'immutable');
    }
    const store = await this.stores.writableStore(trx, tenantId, storeId);
    if (fromStoreId === storeId) throw badField('fromStoreId', 'same_store');
    await this.stores.counterpartStore(
      trx,
      tenantId,
      fromStoreId,
      'fromStoreId',
    );
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(input.lines.map((l) => l.productId.toLowerCase())),
        ])
      ).map((p) => [p.id, p]),
    );
    const seen = new Set<string>();
    const values = input.lines.map((line, i) => {
      const product = products.get(line.productId.toLowerCase());
      if (!product) throw badField(`lines.${i}.productId`, 'unknown_product');
      if (product.status !== 'active') {
        throw badField(`lines.${i}.productId`, 'product_archived');
      }
      if (seen.has(product.id)) {
        throw badField(`lines.${i}.productId`, 'duplicate');
      }
      seen.add(product.id);
      return {
        productId: product.id,
        qtyRequestedPieces: line.quantity * product.piecesPerPack,
      };
    });
    const today = (await this.inventory.settings(trx, tenantId)).today;
    const header = {
      storeId,
      documentDate: current?.documentDate ?? today,
      comment: input.comment.trim() || null,
      totalDirams: 0,
      supplierId: null,
      supplierInvoiceNumber: null,
      paymentDueDate: null,
      purchaseOrderId: null,
      destinationStoreId: fromStoreId,
    };
    if (current === null) {
      const number = await this.numbering.next(
        trx,
        tenantId,
        store,
        'transfer_request',
        today,
      );
      await this.documents.insertDocument(
        trx,
        tenantId,
        id,
        'transfer_request',
        number,
        employeeId,
        header,
      );
    } else {
      await this.documents.updateHeader(trx, tenantId, id, header);
    }
    await this.lines.replaceRequestLines(trx, tenantId, id, values);
    await this.audit.append(trx, {
      action: current === null ? 'document.created' : 'document.updated',
      entityType: 'document',
      entityId: id,
      storeId,
      details: {
        type: 'transfer_request',
        fromStoreId,
        lines: values.length,
      },
    });
    if (input.send) {
      await this.documents.setStatus(trx, tenantId, id, 'sent');
      await this.sentAudit(trx, await this.read(trx, tenantId, id));
    }
  }

  private async sentAudit(trx: TenantTransaction, doc: DocumentRow) {
    await this.audit.append(trx, {
      action: 'transfer_request.sent',
      entityType: 'document',
      entityId: doc.id,
      storeId: doc.storeId,
      details: { number: doc.number, fromStoreId: doc.destinationStoreId },
    });
  }

  private async toDto(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<TransferRequest> {
    return (await this.mapper.requests(trx, tenantId, [doc]))[0];
  }
}
