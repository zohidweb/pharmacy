import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  DocumentAuthor,
  DocumentStatus,
  UnpostCheck,
  WriteOff,
  WriteOffInput,
  WriteOffListQuery,
  WriteOffListResponse,
  WriteOffReason,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { DEFAULT_PAGE_LIMIT } from '../../common/pagination';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import { InventoryRepository } from './inventory.repository';
import { CustomerReturnNumbers } from './customer-return-numbers';
import { Numbering } from './numbering';
import { StockRepository } from './stock.repository';
import { StoreAccess } from './store-access';
import { totalOf, WriteOffPosting } from './write-off-posting';
import {
  type WriteOffLineValues,
  WriteOffsRepository,
} from './write-offs.repository';

const DAY_MS = 86_400_000;
const notFound = () => new ProblemException(404, 'not_found');
const badLine = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

/**
 * The write-off of a transfer shortage is made by the acceptance (spec T6), the one of a customer
 * return by the return (spec 2026-10-13-customer-returns, E9): 409 by hand.
 */
function notFromTransfer(doc: DocumentRow): void {
  if (doc.sourceDocumentId !== null) {
    throw new ProblemException(409, 'write_off_from_transfer');
  }
  if (doc.sourceCustomerReturnId !== null) {
    throw new ProblemException(409, 'write_off_from_return');
  }
}

// Write-offs (spec 2026-10-12-write-offs-stock-counts, section 4): a pharmacist drafts, a manager
// posts. Writing a draft needs no cost right; amounts are sent only with `finance:view-cost`. A
// write-off is seen and written only in the stores of the employee scope.
@Injectable()
export class WriteOffsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly documents: DocumentsRepository,
    private readonly lines: WriteOffsRepository,
    private readonly inventory: InventoryRepository,
    private readonly stock: StockRepository,
    private readonly numbering: Numbering,
    private readonly posting: WriteOffPosting,
    private readonly products: ProductsReader,
    private readonly audit: AuditService,
    private readonly customerReturns: CustomerReturnNumbers,
    private readonly stores: StoreAccess,
  ) {}

  async list(query: WriteOffListQuery): Promise<WriteOffListResponse> {
    const { tenantId } = requirePrincipal();
    const canSeeCost = this.canSeeCost();
    const scope = this.stores.scope();
    const storeId = query.storeId?.toLowerCase();
    if (storeId) this.stores.inScope(storeId);
    const storeIds = storeId ? [storeId] : scope;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total } = await this.documents.listDocuments(
        trx,
        tenantId,
        'write_off',
        { storeIds, status: query.status, writeOffReason: query.reason },
        { limit, offset },
      );
      const stores = await this.inventory.storeNames(
        trx,
        tenantId,
        rows.map((r) => r.storeId),
      );
      const authors = await this.inventory.employeeNames(
        trx,
        tenantId,
        rows.flatMap((r) => (r.postedBy ? [r.postedBy] : [])),
      );
      const settings = await this.inventory.settings(trx, tenantId);
      const month = await this.lines.kpi(
        trx,
        tenantId,
        storeIds,
        settings.today,
      );
      // expired and expiring batches with stock in the active stores of the filter
      const active = (
        await this.inventory.activeStores(trx, tenantId, storeIds)
      ).map((s) => s.id);
      const soon = new Date(
        Date.parse(`${settings.today}T00:00:00Z`) +
          settings.expiryReminderDays * DAY_MS,
      )
        .toISOString()
        .slice(0, 10);
      const expiry = await this.stock.expiryCounts(
        trx,
        tenantId,
        active,
        settings.today,
        soon,
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          number: r.number,
          date: r.documentDate,
          storeName: stores.get(r.storeId) ?? '—',
          reason: r.writeOffReason as WriteOffReason,
          positions: r.positions,
          ...(canSeeCost ? { totalMinor: Number(r.totalDirams ?? 0n) } : {}),
          postedByName: r.postedBy ? (authors.get(r.postedBy) ?? '—') : null,
          // only a stock count is ever cancelled (documents_cancelled_type_check)
          status: r.status as DocumentStatus,
        })),
        total,
        limit,
        offset,
        kpi: {
          documentsThisMonth: month.documents,
          ...(canSeeCost
            ? { writtenOffThisMonthMinor: Number(month.amountDirams) }
            : {}),
          expiredBatches: expiry.expired,
          expiringBatches: expiry.expiring,
        },
      };
    });
  }

  async get(id: string): Promise<WriteOff> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.toDto(trx, tenantId, await this.visible(trx, tenantId, id)),
    );
  }

  async create(input: WriteOffInput): Promise<WriteOff> {
    const { tenantId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      await this.save(trx, tenantId, id, null, input);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, id));
    });
  }

  /** Only a draft: 409 `document_posted` / `write_off_from_transfer`. */
  async update(id: string, input: WriteOffInput): Promise<WriteOff> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, id);
      await this.save(trx, tenantId, doc.id, doc, input);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async post(id: string): Promise<WriteOff> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, id);
      const store = await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.posting.post(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async unpost(id: string): Promise<WriteOff> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id, true);
      notFromTransfer(doc);
      const store = await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.posting.unpost(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async unpostCheck(id: string): Promise<UnpostCheck> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id);
      notFromTransfer(doc);
      const blockers =
        doc.status === 'posted'
          ? await this.posting.blockers(trx, tenantId, doc)
          : [];
      return {
        allowed: doc.status === 'posted' && blockers.length === 0,
        postedBy: await this.author(trx, tenantId, doc.postedBy, doc.postedAt),
        blockers,
      };
    });
  }

  /* ---------------- helpers ---------------- */

  private canSeeCost(): boolean {
    return hasPermissions(requirePrincipal().permissions, 'finance:view-cost');
  }

  private async visible(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<DocumentRow> {
    const doc = await this.documents.findDocument(
      trx,
      tenantId,
      'write_off',
      id.toLowerCase(),
      lock,
    );
    if (doc === null) throw notFound();
    this.stores.inScope(doc.storeId);
    return doc;
  }

  private async lockedDraft(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<DocumentRow> {
    const doc = await this.visible(trx, tenantId, id, true);
    // a write-off of a transfer shortage is never edited or posted by hand, whatever its status
    notFromTransfer(doc);
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
      'write_off',
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
    input: WriteOffInput,
  ): Promise<void> {
    const { employeeId } = requirePrincipal();
    const storeId = input.storeId.toLowerCase();
    if (current !== null && current.storeId !== storeId) {
      throw badLine('storeId', 'immutable');
    }
    const store = await this.stores.writableStore(trx, tenantId, storeId);
    const batchIds = input.lines.map((l) => l.batchId.toLowerCase());
    const batches = await this.lines.batches(trx, tenantId, batchIds);
    // any status: the leftovers of an archived product are written off as well (B1)
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(input.lines.map((l) => l.productId.toLowerCase())),
        ])
      ).map((p) => [p.id, p]),
    );
    const seen = new Set<string>();
    let total = 0;
    const values: WriteOffLineValues[] = input.lines.map((line, i) => {
      const batch = batches.get(batchIds[i]);
      const product = products.get(line.productId.toLowerCase());
      if (!product) throw badLine(`lines.${i}.productId`, 'unknown_product');
      // A batch of another store is reported as unknown: its existence is not told across stores.
      if (!batch || batch.storeId !== storeId) {
        throw badLine(`lines.${i}.batchId`, 'unknown_batch');
      }
      if (batch.productId !== product.id) {
        throw badLine(`lines.${i}.batchId`, 'product_mismatch');
      }
      if (seen.has(batch.id)) throw badLine(`lines.${i}.batchId`, 'duplicate');
      seen.add(batch.id);
      if (line.unit === 'piece' && !product.divisible) {
        throw badLine(`lines.${i}.unit`, 'not_divisible');
      }
      const qtyPieces =
        line.unit === 'piece'
          ? line.quantity
          : line.quantity * product.piecesPerPack;
      total += qtyPieces * Number(batch.costPerPieceDirams);
      return {
        batchId: batch.id,
        productId: product.id,
        qtyPieces,
        unit: line.unit,
      };
    });
    const header = {
      storeId,
      documentDate: input.date,
      comment: input.comment.trim() || null,
      totalDirams: total,
      supplierId: null,
      supplierInvoiceNumber: null,
      paymentDueDate: null,
      purchaseOrderId: null,
      writeOffReason: input.reason,
    };
    if (current === null) {
      // The batches before the counter of write-offs, as the writers that hold batches and then
      // number a write-off (an acceptance of a transfer with a shortage, a customer return): the
      // lines would take these key-share locks after the counter and deadlock with them.
      await this.documents.keyShareBatches(
        trx,
        tenantId,
        values.map((v) => v.batchId),
      );
      const number = await this.numbering.next(
        trx,
        tenantId,
        store,
        'write_off',
        input.date,
      );
      await this.documents.insertDocument(
        trx,
        tenantId,
        id,
        'write_off',
        number,
        employeeId,
        header,
      );
    } else {
      await this.documents.updateHeader(trx, tenantId, id, header);
    }
    await this.lines.replaceLines(trx, tenantId, id, values);
    await this.audit.append(trx, {
      action: current === null ? 'document.created' : 'document.updated',
      entityType: 'document',
      entityId: id,
      storeId,
      details: {
        type: 'write_off',
        reason: input.reason,
        lines: values.length,
      },
    });
  }

  private async author(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string | null,
    at: Date | null,
  ): Promise<DocumentAuthor | null> {
    if (employeeId === null || at === null) return null;
    const names = await this.inventory.employeeNames(trx, tenantId, [
      employeeId,
    ]);
    return { name: names.get(employeeId) ?? '—', at: at.toISOString() };
  }

  private async toDto(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<WriteOff> {
    const canSeeCost = this.canSeeCost();
    const lines = await this.lines.lines(trx, tenantId, doc.id);
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const stores = await this.inventory.storeNames(trx, tenantId, [
      doc.storeId,
    ]);
    const total =
      doc.status === 'posted' ? Number(doc.totalDirams ?? 0n) : totalOf(lines);
    return {
      id: doc.id,
      number: doc.number,
      status: doc.status as DocumentStatus,
      date: doc.documentDate,
      storeId: doc.storeId,
      storeName: stores.get(doc.storeId) ?? '—',
      reason: doc.writeOffReason as WriteOffReason,
      comment: doc.comment ?? '',
      lines: lines.map((line) => {
        const ppp = products.get(line.productId)?.piecesPerPack ?? 1;
        const perUnit = line.unit === 'piece' ? 1 : ppp;
        return {
          productId: line.productId,
          productName: products.get(line.productId)?.name ?? '',
          batchId: line.batchId,
          batchNumber: line.lotNumber ?? '',
          expiresOn: line.expiryDate,
          unit: line.unit,
          quantity: Math.round(line.qtyPieces / perUnit),
          ...(canSeeCost
            ? { costMinor: Number(line.costPerPieceDirams) * perUnit }
            : {}),
        };
      }),
      ...(canSeeCost ? { totalMinor: total } : {}),
      createdBy: (await this.author(
        trx,
        tenantId,
        doc.createdBy,
        doc.createdAt,
      )) as DocumentAuthor,
      postedBy: await this.author(trx, tenantId, doc.postedBy, doc.postedAt),
      transferId: doc.sourceDocumentId,
      transferNumber: doc.sourceDocumentId
        ? ((
            await this.inventory.documentNumbers(trx, tenantId, [
              doc.sourceDocumentId,
            ])
          ).get(doc.sourceDocumentId) ?? null)
        : null,
      customerReturnId: doc.sourceCustomerReturnId,
      customerReturnNumber: doc.sourceCustomerReturnId
        ? ((
            await this.customerReturns.numbers(trx, tenantId, [
              doc.sourceCustomerReturnId,
            ])
          ).get(doc.sourceCustomerReturnId) ?? null)
        : null,
    };
  }
}
