import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  DocumentAuthor,
  DocumentStatus,
  SupplierReturn,
  SupplierReturnInput,
  SupplierReturnListQuery,
  SupplierReturnListResponse,
  SupplierReturnReason,
  UnpostCheck,
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
import { SuppliersReader } from '../purchasing/suppliers-reader';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import { InventoryRepository } from './inventory.repository';
import { Numbering } from './numbering';
import { StoreAccess } from './store-access';
import { SupplierReturnPosting } from './supplier-return-posting';
import {
  returnAmount,
  withPiecesPerPack,
  type SupplierReturnLineValues,
  SupplierReturnsRepository,
} from './supplier-returns.repository';

const notFound = () => new ProblemException(404, 'not_found');
const badField = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

// Supplier returns (spec 2026-10-12-supplier-returns-transfers, section 4): a pharmacist drafts, a
// manager posts; posting takes the batches off the stock and credits the supplier. Writing a draft
// needs no cost right; amounts are sent only with `finance:view-cost`. A return is seen and written
// only in the stores of the employee scope.
@Injectable()
export class SupplierReturnsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly documents: DocumentsRepository,
    private readonly lines: SupplierReturnsRepository,
    private readonly inventory: InventoryRepository,
    private readonly numbering: Numbering,
    private readonly posting: SupplierReturnPosting,
    private readonly products: ProductsReader,
    private readonly suppliers: SuppliersReader,
    private readonly audit: AuditService,
    private readonly stores: StoreAccess,
  ) {}

  async list(
    query: SupplierReturnListQuery,
  ): Promise<SupplierReturnListResponse> {
    const { tenantId } = requirePrincipal();
    const canSeeCost = this.canSeeCost();
    const scope = this.stores.scope();
    const storeId = query.storeId?.toLowerCase();
    if (storeId) this.stores.inScope(storeId);
    const storeIds = storeId ? [storeId] : scope;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total } = await this.documents.listDocuments(
        trx,
        tenantId,
        'supplier_return',
        {
          storeIds,
          status: query.status,
          supplierId: query.supplierId?.toLowerCase(),
          supplierReturnReason: query.reason,
        },
        { limit, offset },
      );
      const stores = await this.inventory.storeNames(
        trx,
        tenantId,
        rows.map((r) => r.storeId),
      );
      const suppliers = await this.suppliers.names(trx, tenantId, [
        ...new Set(rows.map((r) => r.supplierId as string)),
      ]);
      const receipts = await this.lines.numbers(
        trx,
        tenantId,
        rows.flatMap((r) => (r.sourceDocumentId ? [r.sourceDocumentId] : [])),
      );
      const settings = await this.inventory.settings(trx, tenantId);
      const month = await this.lines.kpi(
        trx,
        tenantId,
        storeIds,
        settings.today,
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          number: r.number,
          date: r.documentDate,
          supplierName: suppliers.get(r.supplierId ?? '') ?? '—',
          receiptNumber: r.sourceDocumentId
            ? (receipts.get(r.sourceDocumentId) ?? null)
            : null,
          storeName: stores.get(r.storeId) ?? '—',
          reason: r.supplierReturnReason as SupplierReturnReason,
          ...(canSeeCost ? { totalMinor: Number(r.totalDirams ?? 0n) } : {}),
          status: r.status as DocumentStatus,
        })),
        total,
        limit,
        offset,
        kpi: {
          documentsThisMonth: month.documents,
          ...(canSeeCost
            ? { returnedThisMonthMinor: Number(month.amountDirams) }
            : {}),
        },
      };
    });
  }

  async get(id: string): Promise<SupplierReturn> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.toDto(trx, tenantId, await this.visible(trx, tenantId, id)),
    );
  }

  async create(input: SupplierReturnInput): Promise<SupplierReturn> {
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
    input: SupplierReturnInput,
  ): Promise<SupplierReturn> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, id);
      await this.save(trx, tenantId, doc.id, doc, input);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async post(id: string): Promise<SupplierReturn> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, id);
      const store = await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.posting.post(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async unpost(id: string): Promise<SupplierReturn> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id, true);
      const store = await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.posting.unpost(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async unpostCheck(id: string): Promise<UnpostCheck> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id);
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
      'supplier_return',
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
      'supplier_return',
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
    input: SupplierReturnInput,
  ): Promise<void> {
    const { employeeId } = requirePrincipal();
    const storeId = input.storeId.toLowerCase();
    if (current !== null && current.storeId !== storeId) {
      throw badField('storeId', 'immutable');
    }
    const store = await this.stores.writableStore(trx, tenantId, storeId);
    // as a goods receipt: an unknown or archived supplier
    const supplier = await this.suppliers.findActive(
      trx,
      tenantId,
      input.supplierId.toLowerCase(),
    );
    if (supplier === null) throw badField('supplierId', 'unknown_supplier');
    let receiptId: string | null = null;
    if (input.receiptId !== null) {
      const receipt = await this.documents.findDocument(
        trx,
        tenantId,
        'goods_receipt',
        input.receiptId.toLowerCase(),
      );
      if (
        receipt === null ||
        receipt.status !== 'posted' ||
        receipt.supplierId !== supplier.id ||
        receipt.storeId !== storeId
      ) {
        throw badField('receiptId', 'unknown_receipt');
      }
      receiptId = receipt.id;
    }
    const batchIds = input.lines.map((l) => l.batchId.toLowerCase());
    const batches = await this.lines.batches(trx, tenantId, batchIds);
    // any status: the leftovers of an archived product go back as well
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(input.lines.map((l) => l.productId.toLowerCase())),
        ])
      ).map((p) => [p.id, p]),
    );
    const seen = new Set<string>();
    let total = 0;
    const values: SupplierReturnLineValues[] = input.lines.map((line, i) => {
      const batch = batches.get(batchIds[i]);
      const product = products.get(line.productId.toLowerCase());
      if (
        !batch ||
        !product ||
        batch.storeId !== storeId ||
        batch.productId !== product.id
      ) {
        throw badField(`lines.${i}.batchId`, 'unknown_batch');
      }
      if (batch.supplierId !== supplier.id) {
        throw badField(`lines.${i}.batchId`, 'wrong_supplier');
      }
      if (seen.has(batch.id)) throw badField(`lines.${i}.batchId`, 'duplicate');
      seen.add(batch.id);
      if (line.unit === 'piece' && !product.divisible) {
        throw badField(`lines.${i}.unit`, 'not_divisible');
      }
      const qtyPieces =
        line.unit === 'piece'
          ? line.quantity
          : line.quantity * product.piecesPerPack;
      total += returnAmount({
        qtyPieces,
        unit: line.unit,
        purchasePricePerPackDirams: batch.purchasePricePerPackDirams,
        costPerPieceDirams: batch.costPerPieceDirams,
        piecesPerPack: product.piecesPerPack,
      });
      return {
        batchId: batch.id,
        productId: product.id,
        qtyPieces,
        unit: line.unit,
        note: line.note.trim() || null,
      };
    });
    const header = {
      storeId,
      documentDate: input.date,
      comment: input.comment.trim() || null,
      totalDirams: total,
      supplierId: supplier.id,
      supplierInvoiceNumber: null,
      paymentDueDate: null,
      purchaseOrderId: null,
      supplierReturnReason: input.reason,
      sourceDocumentId: receiptId,
    };
    if (current === null) {
      const number = await this.numbering.next(
        trx,
        tenantId,
        store,
        'supplier_return',
        input.date,
      );
      await this.documents.insertDocument(
        trx,
        tenantId,
        id,
        'supplier_return',
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
        type: 'supplier_return',
        supplierId: supplier.id,
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
  ): Promise<SupplierReturn> {
    const canSeeCost = this.canSeeCost();
    const rows = await this.lines.lines(trx, tenantId, doc.id);
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(rows.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const names = new Map([...products].map(([id, p]) => [id, p.name]));
    const lines = withPiecesPerPack(rows, products);
    const stores = await this.inventory.storeNames(trx, tenantId, [
      doc.storeId,
    ]);
    const supplierId = doc.supplierId as string;
    const suppliers = await this.suppliers.names(trx, tenantId, [supplierId]);
    const receipts = await this.lines.numbers(
      trx,
      tenantId,
      doc.sourceDocumentId ? [doc.sourceDocumentId] : [],
    );
    const total =
      doc.status === 'posted'
        ? Number(doc.totalDirams ?? 0n)
        : lines.reduce((sum, l) => sum + returnAmount(l), 0);
    return {
      id: doc.id,
      number: doc.number,
      status: doc.status as DocumentStatus,
      date: doc.documentDate,
      supplierId,
      supplierName: suppliers.get(supplierId) ?? '—',
      storeId: doc.storeId,
      storeName: stores.get(doc.storeId) ?? '—',
      receiptId: doc.sourceDocumentId,
      receiptNumber: doc.sourceDocumentId
        ? (receipts.get(doc.sourceDocumentId) ?? null)
        : null,
      reason: doc.supplierReturnReason as SupplierReturnReason,
      comment: doc.comment ?? '',
      lines: lines.map((line) => {
        const perUnit = line.unit === 'piece' ? 1 : line.piecesPerPack;
        return {
          productId: line.productId,
          productName: names.get(line.productId) ?? '',
          batchId: line.batchId,
          batchNumber: line.lotNumber ?? '',
          expiresOn: line.expiryDate,
          unit: line.unit,
          quantity: Math.round(line.qtyPieces / perUnit),
          note: line.note ?? '',
          // the purchase price of the unit: a pack, or a piece rounded up
          ...(canSeeCost
            ? {
                costMinor:
                  line.unit === 'piece'
                    ? Number(line.costPerPieceDirams)
                    : Number(line.purchasePricePerPackDirams),
              }
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
    };
  }
}
