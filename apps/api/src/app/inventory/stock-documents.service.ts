import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  DocumentAuthor,
  DocumentListQuery,
  GoodsReceipt,
  GoodsReceiptInput,
  GoodsReceiptListResponse,
  OpeningBalance,
  OpeningBalanceInput,
  OpeningBalanceListResponse,
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
import {
  type PricingProduct,
  ProductsReader,
} from '../catalog/products-reader';
import { SuppliersReader } from '../purchasing/suppliers-reader';
import {
  type DocumentRow,
  DocumentsRepository,
  type HeaderValues,
  type LineRow,
  type LineValues,
  type StockDocumentType,
} from './documents.repository';
import {
  InventoryRepository,
  type StoreForWrite,
} from './inventory.repository';
import { Numbering } from './numbering';
import { DocumentPosting, linesTotal, packsOf } from './posting';

const DAY_MS = 86_400_000;
const notFound = () => new ProblemException(404, 'not_found');
const badField = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

type InputLine = {
  productId: string;
  batchNumber: string;
  expiresOn: string;
  quantity: number;
  costMinor: number;
  retailPriceMinor: number | null;
  starting?: boolean;
};

/** The same line of a draft keeps its batch: product, expiry, lot and price unchanged. */
const sameLine = (old: LineRow, line: LineValues) =>
  old.productId === line.productId &&
  old.expiryDate === line.expiryDate &&
  (old.lotNumber ?? '') === (line.lotNumber ?? '') &&
  Number(old.purchasePricePerPackDirams) === line.purchasePricePerPackDirams;

// Goods receipts and opening balances (spec 2026-10-09-inventory-purchasing, section 4.1): drafts
// with a number from creation, posting and unposting through DocumentPosting. A document is seen
// and written only in the stores of the employee scope; offline stores keep their own documents.
@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly documents: DocumentsRepository,
    private readonly inventory: InventoryRepository,
    private readonly numbering: Numbering,
    private readonly posting: DocumentPosting,
    private readonly products: ProductsReader,
    private readonly suppliers: SuppliersReader,
    private readonly audit: AuditService,
  ) {}

  /* ---------------- reads ---------------- */

  async listReceipts(
    query: DocumentListQuery,
  ): Promise<GoodsReceiptListResponse> {
    const { tenantId, permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total, limit, offset, storeIds } = await this.list(
        trx,
        tenantId,
        'goods_receipt',
        query,
      );
      const suppliers = await this.suppliers.names(
        trx,
        tenantId,
        rows.flatMap((r) => (r.supplierId ? [r.supplierId] : [])),
      );
      const stores = await this.inventory.storeNames(
        trx,
        tenantId,
        rows.map((r) => r.storeId),
      );
      const settings = await this.inventory.settings(trx, tenantId);
      const kpi = await this.documents.kpi(
        trx,
        tenantId,
        'goods_receipt',
        storeIds,
        settings.today,
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          number: r.number,
          date: r.documentDate,
          supplierName: suppliers.get(r.supplierId ?? '') ?? '—',
          orderNumber: null,
          storeName: stores.get(r.storeId) ?? '—',
          positions: r.positions,
          ...(canSeeCost ? { totalMinor: Number(r.totalDirams ?? 0n) } : {}),
          status: r.status,
        })),
        total,
        limit,
        offset,
        kpi: {
          postedThisMonth: kpi.postedThisMonth,
          ...(canSeeCost
            ? { postedThisMonthMinor: Number(kpi.postedThisMonthDirams) }
            : {}),
          drafts: kpi.drafts,
        },
      };
    });
  }

  async listOpeningBalances(
    query: DocumentListQuery,
  ): Promise<OpeningBalanceListResponse> {
    const { tenantId, permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total, limit, offset } = await this.list(
        trx,
        tenantId,
        'opening_balance',
        query,
      );
      const stores = await this.inventory.storeNames(
        trx,
        tenantId,
        rows.map((r) => r.storeId),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          number: r.number,
          date: r.documentDate,
          storeName: stores.get(r.storeId) ?? '—',
          positions: r.positions,
          ...(canSeeCost ? { totalMinor: Number(r.totalDirams ?? 0n) } : {}),
          status: r.status,
        })),
        total,
        limit,
        offset,
      };
    });
  }

  async getReceipt(id: string): Promise<GoodsReceipt> {
    this.requireCost();
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.toReceipt(
        trx,
        tenantId,
        await this.visible(trx, tenantId, 'goods_receipt', id),
      ),
    );
  }

  async getOpeningBalance(id: string): Promise<OpeningBalance> {
    this.requireCost();
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.toOpeningBalance(
        trx,
        tenantId,
        await this.visible(trx, tenantId, 'opening_balance', id),
      ),
    );
  }

  async unpostCheck(type: StockDocumentType, id: string): Promise<UnpostCheck> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, type, id);
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

  /* ---------------- writes ---------------- */

  async createReceipt(input: GoodsReceiptInput): Promise<GoodsReceipt> {
    const { tenantId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      await this.save(trx, tenantId, 'goods_receipt', id, null, input);
      return this.toReceipt(
        trx,
        tenantId,
        await this.read(trx, tenantId, 'goods_receipt', id),
      );
    });
  }

  async updateReceipt(
    id: string,
    input: GoodsReceiptInput,
  ): Promise<GoodsReceipt> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, 'goods_receipt', id);
      await this.save(trx, tenantId, 'goods_receipt', doc.id, doc, input);
      return this.toReceipt(
        trx,
        tenantId,
        await this.read(trx, tenantId, 'goods_receipt', doc.id),
      );
    });
  }

  async createOpeningBalance(
    input: OpeningBalanceInput,
  ): Promise<OpeningBalance> {
    const { tenantId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      await this.save(trx, tenantId, 'opening_balance', id, null, input);
      return this.toOpeningBalance(
        trx,
        tenantId,
        await this.read(trx, tenantId, 'opening_balance', id),
      );
    });
  }

  async updateOpeningBalance(
    id: string,
    input: OpeningBalanceInput,
  ): Promise<OpeningBalance> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, 'opening_balance', id);
      await this.save(trx, tenantId, 'opening_balance', doc.id, doc, input);
      return this.toOpeningBalance(
        trx,
        tenantId,
        await this.read(trx, tenantId, 'opening_balance', doc.id),
      );
    });
  }

  async post(
    type: StockDocumentType,
    id: string,
  ): Promise<GoodsReceipt | OpeningBalance> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.lockedDraft(trx, tenantId, type, id);
      const store = await this.writableStore(trx, tenantId, doc.storeId);
      await this.posting.post(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(
        trx,
        tenantId,
        await this.read(trx, tenantId, type, doc.id),
      );
    });
  }

  async unpost(
    type: StockDocumentType,
    id: string,
  ): Promise<GoodsReceipt | OpeningBalance> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, type, id, true);
      const store = await this.writableStore(trx, tenantId, doc.storeId);
      await this.posting.unpost(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(
        trx,
        tenantId,
        await this.read(trx, tenantId, type, doc.id),
      );
    });
  }

  /* ---------------- helpers ---------------- */

  private requireCost(): void {
    const { permissions } = requirePrincipal();
    // a stock document without its purchase prices makes no sense (ADR-0018, п. 6)
    if (!hasPermissions(permissions, 'finance:view-cost')) {
      throw new ProblemException(403, 'forbidden');
    }
  }

  private scope(): readonly string[] | null {
    const { storeScope } = requirePrincipal();
    return storeScope === 'all' ? null : storeScope;
  }

  private inScope(storeId: string): void {
    const scope = this.scope();
    if (scope !== null && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
  }

  private async list(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    query: DocumentListQuery,
  ) {
    const scope = this.scope();
    if (query.storeId) this.inScope(query.storeId.toLowerCase());
    const storeIds = query.storeId ? [query.storeId.toLowerCase()] : scope;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const { rows, total } = await this.documents.listDocuments(
      trx,
      tenantId,
      type,
      {
        storeIds,
        status: query.status,
        supplierId: query.supplierId?.toLowerCase(),
      },
      { limit, offset },
    );
    return { rows, total, limit, offset, storeIds };
  }

  private async visible(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    id: string,
    lock = false,
  ): Promise<DocumentRow> {
    const doc = await this.documents.findDocument(
      trx,
      tenantId,
      type,
      id.toLowerCase(),
      lock,
    );
    if (doc === null) throw notFound();
    this.inScope(doc.storeId);
    return doc;
  }

  private async lockedDraft(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    id: string,
  ): Promise<DocumentRow> {
    const doc = await this.visible(trx, tenantId, type, id, true);
    if (doc.status !== 'draft')
      throw new ProblemException(409, 'document_posted');
    return doc;
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    id: string,
  ): Promise<DocumentRow> {
    const doc = await this.documents.findDocument(trx, tenantId, type, id);
    if (doc === null)
      throw new Error('The document just written is not readable');
    return doc;
  }

  /** The store of a write: in the scope, active and a cloud store (ADR-0014). */
  private async writableStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<StoreForWrite> {
    this.inScope(storeId);
    const store = await this.inventory.store(trx, tenantId, storeId);
    if (store === null || store.status !== 'active') throw notFound();
    if (store.mode !== 'online')
      throw new ProblemException(409, 'offline_store_read_only');
    return store;
  }

  private async save(
    trx: TenantTransaction,
    tenantId: string,
    type: StockDocumentType,
    id: string,
    current: DocumentRow | null,
    input: GoodsReceiptInput | OpeningBalanceInput,
  ): Promise<void> {
    const { employeeId } = requirePrincipal();
    const storeId = input.storeId.toLowerCase();
    if (current !== null && current.storeId !== storeId) {
      throw badField('storeId', 'immutable');
    }
    const store = await this.writableStore(trx, tenantId, storeId);

    let supplierId: string | null = null;
    let invoiceNumber: string | null = null;
    let dueDate: string | null = null;
    if (type === 'goods_receipt') {
      const receipt = input as GoodsReceiptInput;
      if (receipt.orderId !== null) throw badField('orderId', 'not_supported');
      const supplier = await this.suppliers.findActive(
        trx,
        tenantId,
        receipt.supplierId.toLowerCase(),
      );
      if (supplier === null) throw badField('supplierId', 'unknown_supplier');
      supplierId = supplier.id;
      invoiceNumber = receipt.invoiceNumber.trim() || null;
      dueDate =
        receipt.paymentDueOn ??
        new Date(
          Date.parse(`${input.date}T00:00:00Z`) +
            supplier.paymentTermDays * DAY_MS,
        )
          .toISOString()
          .slice(0, 10);
    }

    const lines = input.lines as readonly InputLine[];
    const products = new Map(
      (
        await this.products.findForPricing(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId.toLowerCase())),
        ])
      ).map((p) => [p.id, p]),
    );
    const values: LineValues[] = lines.map((line, i) => {
      const product = products.get(line.productId.toLowerCase());
      if (!product) throw badField(`lines.${i}.productId`, 'unknown_product');
      return {
        productId: product.id,
        qtyPieces: line.quantity * product.piecesPerPack,
        expiryDate: line.expiresOn,
        lotNumber: line.batchNumber.trim() || null,
        purchasePricePerPackDirams: line.costMinor,
        retailPriceDraftDirams: line.retailPriceMinor,
        batchId: null,
        isStarting: type === 'opening_balance' && line.starting === true,
      };
    });
    // a line unchanged since an unposting keeps its batch (spec 4.1)
    if (current !== null) {
      const free = (await this.documents.lines(trx, tenantId, type, id)).filter(
        (l) => l.batchId,
      );
      for (const line of values) {
        const index = free.findIndex((old) => sameLine(old, line));
        if (index >= 0) {
          line.batchId = free[index].batchId;
          free.splice(index, 1);
        }
      }
    }

    const header: HeaderValues = {
      storeId,
      documentDate: input.date,
      comment:
        type === 'opening_balance'
          ? (input as OpeningBalanceInput).comment.trim() || null
          : null,
      totalDirams: values.reduce(
        (sum, l) =>
          sum +
          l.purchasePricePerPackDirams *
            (l.qtyPieces /
              (products.get(l.productId) as PricingProduct).piecesPerPack),
        0,
      ),
      supplierId,
      supplierInvoiceNumber: invoiceNumber,
      paymentDueDate: dueDate,
    };
    if (current === null) {
      const kind =
        type === 'goods_receipt' ? 'goods_receipt' : 'opening_balance';
      const number = await this.numbering.next(
        trx,
        tenantId,
        store,
        kind,
        input.date,
      );
      await this.documents.insertDocument(
        trx,
        tenantId,
        id,
        type,
        number,
        employeeId,
        header,
      );
    } else {
      await this.documents.updateHeader(trx, tenantId, id, header);
    }
    await this.documents.replaceLines(trx, tenantId, type, id, values);
    await this.audit.append(trx, {
      action: current === null ? 'document.created' : 'document.updated',
      entityType: 'document',
      entityId: id,
      storeId,
      details: { type, lines: values.length },
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
  ): Promise<GoodsReceipt | OpeningBalance> {
    return doc.type === 'goods_receipt'
      ? this.toReceipt(trx, tenantId, doc)
      : this.toOpeningBalance(trx, tenantId, doc);
  }

  private async common(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ) {
    const lines = await this.documents.lines(trx, tenantId, doc.type, doc.id);
    const products = new Map(
      (
        await this.products.findForPricing(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const ppp = (productId: string) =>
      products.get(productId)?.piecesPerPack ?? 1;
    const stores = await this.inventory.storeNames(trx, tenantId, [
      doc.storeId,
    ]);
    return {
      lines,
      products,
      ppp,
      storeName: stores.get(doc.storeId) ?? '—',
      total:
        doc.totalDirams === null
          ? linesTotal(lines, ppp)
          : Number(doc.totalDirams),
      createdBy: (await this.author(
        trx,
        tenantId,
        doc.createdBy,
        doc.createdAt,
      )) as DocumentAuthor,
      postedBy: await this.author(trx, tenantId, doc.postedBy, doc.postedAt),
    };
  }

  private async toReceipt(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<GoodsReceipt> {
    const c = await this.common(trx, tenantId, doc);
    const suppliers = await this.suppliers.names(
      trx,
      tenantId,
      doc.supplierId ? [doc.supplierId] : [],
    );
    return {
      id: doc.id,
      number: doc.number,
      status: doc.status,
      date: doc.documentDate,
      supplierId: doc.supplierId ?? '',
      supplierName: suppliers.get(doc.supplierId ?? '') ?? '—',
      storeId: doc.storeId,
      storeName: c.storeName,
      orderId: null,
      orderNumber: null,
      invoiceNumber: doc.supplierInvoiceNumber ?? '',
      paymentDueOn: doc.paymentDueDate,
      lines: c.lines.map((line) => ({
        productId: line.productId,
        productName: c.products.get(line.productId)?.name ?? '',
        batchNumber: line.lotNumber ?? '',
        expiresOn: line.expiryDate,
        quantity: packsOf(line, c.ppp(line.productId)),
        orderPriceMinor: null,
        costMinor: Number(line.purchasePricePerPackDirams),
        retailPriceMinor: Number(line.retailPriceDraftDirams ?? 0n),
      })),
      totalMinor: c.total,
      createdBy: c.createdBy,
      postedBy: c.postedBy,
    };
  }

  private async toOpeningBalance(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<OpeningBalance> {
    const c = await this.common(trx, tenantId, doc);
    return {
      id: doc.id,
      number: doc.number,
      status: doc.status,
      date: doc.documentDate,
      storeId: doc.storeId,
      storeName: c.storeName,
      comment: doc.comment ?? '',
      lines: c.lines.map((line) => ({
        productId: line.productId,
        productName: c.products.get(line.productId)?.name ?? '',
        batchNumber: line.lotNumber ?? '',
        expiresOn: line.expiryDate,
        quantity: packsOf(line, c.ppp(line.productId)),
        costMinor: Number(line.purchasePricePerPackDirams),
        retailPriceMinor:
          line.retailPriceDraftDirams === null
            ? null
            : Number(line.retailPriceDraftDirams),
        starting: line.isStarting,
      })),
      totalMinor: c.total,
      createdBy: c.createdBy,
      postedBy: c.postedBy,
    };
  }
}
