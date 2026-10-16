import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import { sql } from 'kysely';
import type {
  DocumentAuthor,
  FoundLineInput,
  StartStockCountRequest,
  StockCount,
  StockCountEntryRequest,
  StockCountLine,
  StockCountVersion,
  StockCountListItem,
  StockCountListQuery,
  UnpostCheck,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
  uniqueConstraint,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import { InventoryRepository } from './inventory.repository';
import { Numbering } from './numbering';
import { StockCountPosting } from './stock-count-posting';
import {
  type CountEntryRow,
  type CountLineRow,
  StockCountsRepository,
} from './stock-counts.repository';
import { StockFreeze } from './stock-freeze';
import { StoreAccess } from './store-access';

const notFound = () => new ProblemException(404, 'not_found');
const badField = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);
const running = () => new ProblemException(409, 'stock_count_in_progress');
const STATUSES = {
  draft: 'in_progress',
  posted: 'posted',
  cancelled: 'cancelled',
} as const;
/** A stock count is only ever draft, posted or cancelled (documents_status_type_check). */
const STATUS = STATUSES as Record<string, StockCount['status']>;

// Stock counts (spec 2026-10-12-write-offs-stock-counts, section 5): a manager starts a count with
// a snapshot of the book stock, the employees count on tablets (entries add up), found products get
// their own lines, and the count is posted, unposted or cancelled. Costs only with
// `finance:view-cost`. A running count freezes its scope (StockFreeze).
@Injectable()
export class StockCountsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly documents: DocumentsRepository,
    private readonly counts: StockCountsRepository,
    private readonly inventory: InventoryRepository,
    private readonly numbering: Numbering,
    private readonly products: ProductsReader,
    private readonly freeze: StockFreeze,
    private readonly stores: StoreAccess,
    private readonly posting: StockCountPosting,
    private readonly audit: AuditService,
  ) {}

  /* ---------------- reads ---------------- */

  async list(query: StockCountListQuery): Promise<{
    items: StockCountListItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { tenantId } = requirePrincipal();
    const canSeeCost = this.canSeeCost();
    const storeId = query.storeId?.toLowerCase();
    if (storeId) this.stores.inScope(storeId);
    const storeIds = storeId ? [storeId] : this.stores.scope();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const status =
      query.status === 'in_progress' ? 'draft' : (query.status ?? undefined);
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total } = await this.documents.listDocuments(
        trx,
        tenantId,
        'inventory',
        { storeIds, status },
        { limit, offset },
      );
      const stores = await this.inventory.storeNames(
        trx,
        tenantId,
        rows.map((r) => r.storeId),
      );
      const categories = await this.categoryNames(trx, tenantId, rows);
      const summaries = await this.counts.summaries(
        trx,
        tenantId,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((r) => {
          const summary = summaries.get(r.id);
          return {
            id: r.id,
            number: r.number,
            startedAt: (r.inventoryStartedAt as Date).toISOString(),
            storeName: stores.get(r.storeId) ?? '—',
            scope: r.inventoryScope ?? 'all',
            categoryName: categories.get(r.inventoryCategoryId ?? '') ?? null,
            positions: r.positions,
            surplusLines: summary?.surplusLines ?? 0,
            shortageLines: summary?.shortageLines ?? 0,
            ...(canSeeCost
              ? { diffMinor: Number(summary?.diffDirams ?? 0n) }
              : {}),
            status: STATUS[r.status],
          };
        }),
        total,
        limit,
        offset,
      };
    });
  }

  async get(id: string): Promise<StockCount> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      this.toDto(trx, tenantId, await this.visible(trx, tenantId, id)),
    );
  }

  /** What a running count polls (cnt-poll): the full document is reloaded only when it changes. */
  async version(id: string): Promise<StockCountVersion> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id);
      return { version: await this.counts.version(trx, tenantId, doc.id) };
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

  /* ---------------- the count ---------------- */

  /** 409 `stock_count_in_progress` when the store already counts. */
  async start(input: StartStockCountRequest): Promise<StockCount> {
    const { tenantId, employeeId } = requirePrincipal();
    const storeId = input.storeId.toLowerCase();
    const id = newId();
    try {
      return await this.db.tenantTransaction(async (trx) => {
        const store = await this.stores.writableStore(trx, tenantId, storeId);
        // the snapshot and the postings of the store are ordered by the stock lock (5.3)
        await this.freeze.lockExclusive(trx, tenantId, storeId);
        if ((await this.counts.running(trx, tenantId, storeId)) !== null) {
          throw running();
        }
        let productIds: string[] | null = null;
        let categoryId: string | null = null;
        if (input.scope === 'category') {
          if (!input.categoryId) throw badField('categoryId', 'required');
          const category = await this.products.category(
            trx,
            tenantId,
            input.categoryId.toLowerCase(),
          );
          if (category === null) throw badField('categoryId', 'unknown');
          categoryId = category.id;
          productIds = category.productIds;
        }
        const settings = await this.inventory.settings(trx, tenantId);
        const number = await this.numbering.next(
          trx,
          tenantId,
          store,
          'inventory',
          settings.today,
        );
        await this.documents.insertDocument(
          trx,
          tenantId,
          id,
          'inventory',
          number,
          employeeId,
          {
            storeId,
            documentDate: settings.today,
            comment: null,
            totalDirams: 0,
            supplierId: null,
            supplierInvoiceNumber: null,
            paymentDueDate: null,
            purchaseOrderId: null,
            inventoryScope: input.scope,
            inventoryCategoryId: categoryId,
            inventoryStartedAt: sql<Date>`now()`,
          },
        );
        const lines =
          productIds !== null && productIds.length === 0
            ? 0
            : await this.counts.snapshot(
                trx,
                tenantId,
                id,
                storeId,
                productIds,
              );
        await this.audit.append(trx, {
          action: 'stock_count.started',
          entityType: 'document',
          entityId: id,
          storeId,
          details: {
            number,
            scope: input.scope,
            categoryId,
            lines,
          },
        });
        return this.toDto(trx, tenantId, await this.read(trx, tenantId, id));
      });
    } catch (error) {
      // a concurrent start of the same store
      if (uniqueConstraint(error) === 'documents_running_count_uq') {
        throw running();
      }
      throw error;
    }
  }

  async saveComment(id: string, comment: string): Promise<StockCount> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      // the header it updates is locked for update at once: two comments taking it FOR SHARE and
      // then updating it would deadlock
      const doc = await this.runningCount(trx, tenantId, id, true);
      await this.counts.setComment(
        trx,
        tenantId,
        doc.id,
        comment.trim() || null,
      );
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  /**
   * «Counted N pieces»: the id of the tablet is the idempotency key — a repeat returns the same
   * line, another body with it — 409 `idempotency_conflict`.
   */
  async addEntry(
    id: string,
    input: StockCountEntryRequest,
  ): Promise<StockCountLine> {
    const { tenantId, employeeId } = requirePrincipal();
    const entryId = input.id.toLowerCase();
    const lineId = input.lineId.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.runningCount(trx, tenantId, id);
      if (!(await this.counts.isLineOf(trx, tenantId, doc.id, lineId))) {
        throw badField('lineId', 'unknown');
      }
      const inserted = await this.counts.insertEntry(trx, tenantId, {
        id: entryId,
        documentId: doc.id,
        lineId,
        qtyPieces: input.pieces,
        enteredBy: employeeId,
      });
      if (!inserted) {
        const seen = await this.counts.findEntry(trx, tenantId, entryId);
        if (
          seen === null ||
          seen.documentId !== doc.id ||
          seen.lineId !== lineId ||
          seen.qtyPieces !== input.pieces
        ) {
          throw new ProblemException(409, 'idempotency_conflict');
        }
      }
      return this.lineOf(trx, tenantId, doc, lineId);
    });
  }

  /** One's own entry; another one's with `inventory:post`. */
  async deleteEntry(id: string, entryId: string): Promise<StockCountLine> {
    const { tenantId, employeeId, permissions } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.runningCount(trx, tenantId, id);
      const entry = await this.counts.findEntry(
        trx,
        tenantId,
        entryId.toLowerCase(),
      );
      if (entry === null || entry.documentId !== doc.id) throw notFound();
      if (
        entry.enteredBy !== employeeId &&
        !hasPermissions(permissions, 'inventory:post')
      ) {
        throw new ProblemException(403, 'forbidden');
      }
      await this.counts.deleteEntry(trx, tenantId, entry.id);
      return this.lineOf(trx, tenantId, doc, entry.lineId);
    });
  }

  /** A product found without a book batch (spec S1); 409 `product_archived`. */
  async addFoundLine(id: string, input: FoundLineInput): Promise<StockCount> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.runningCount(trx, tenantId, id, true);
      const [product] = await this.products.findForStock(trx, tenantId, [
        input.productId.toLowerCase(),
      ]);
      if (!product) throw badField('productId', 'unknown_product');
      if (product.status !== 'active') {
        throw new FieldProblemException(409, 'product_archived', [
          { field: 'productId', code: 'product_archived' },
        ]);
      }
      const lineId = await this.counts.insertFoundLine(trx, tenantId, doc.id, {
        productId: product.id,
        lotNumber: input.batchNumber.trim() || null,
        expiryDate: input.expiresOn,
        purchasePricePerPackDirams: this.canSeeCost() ? input.costMinor : null,
      });
      await this.audit.append(trx, {
        action: 'stock_count.found_line_added',
        entityType: 'document',
        entityId: doc.id,
        storeId: doc.storeId,
        details: { lineId, productId: product.id },
      });
      return this.toDto(trx, tenantId, doc);
    });
  }

  async updateFoundLine(
    id: string,
    lineId: string,
    input: FoundLineInput,
  ): Promise<StockCount> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.runningCount(trx, tenantId, id, true);
      const line = await this.foundLine(trx, tenantId, doc, lineId);
      await this.counts.updateFoundLine(trx, tenantId, line.id, {
        lotNumber: input.batchNumber.trim() || null,
        expiryDate: input.expiresOn,
        // without the cost right the price is neither shown nor changed
        ...(this.canSeeCost()
          ? { purchasePricePerPackDirams: input.costMinor }
          : {}),
      });
      return this.toDto(trx, tenantId, doc);
    });
  }

  /** Only while the line has no entries. */
  async deleteFoundLine(id: string, lineId: string): Promise<StockCount> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.runningCount(trx, tenantId, id, true);
      const line = await this.foundLine(trx, tenantId, doc, lineId);
      if ((await this.counts.entriesOfLine(trx, tenantId, line.id)) > 0) {
        throw badField('lineId', 'has_entries');
      }
      await this.counts.deleteLine(trx, tenantId, line.id);
      return this.toDto(trx, tenantId, doc);
    });
  }

  async post(id: string): Promise<StockCount> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id, true);
      const store = await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.posting.post(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async unpost(id: string): Promise<StockCount> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id, true);
      const store = await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.posting.unpost(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  /** A running count is closed without movements; the freeze is lifted (S6). */
  async cancel(id: string): Promise<StockCount> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id, true);
      await this.stores.writableStore(trx, tenantId, doc.storeId);
      await this.freeze.lockExclusive(trx, tenantId, doc.storeId);
      this.assertRunning(doc);
      // What was sold before and after the count is fixed at the cancel, as at the posting: a
      // cancelled count no longer drifts with every later sale.
      const lines = await this.counts.lines(trx, tenantId, doc.id);
      await this.counts.fixSold(
        trx,
        tenantId,
        lines
          .filter((line) => !line.isFound)
          .map((line) => {
            const atFirst = line.stockAtFirstEntryPieces ?? line.stockPieces;
            return {
              lineId: line.id,
              soldSinceStartPieces: line.bookQtyPieces - atFirst,
              soldAfterCountPieces: atFirst - line.stockPieces,
            };
          }),
      );
      await this.counts.markCancelled(trx, tenantId, doc.id, employeeId);
      await this.audit.append(trx, {
        action: 'stock_count.cancelled',
        entityType: 'document',
        entityId: doc.id,
        storeId: doc.storeId,
        details: { number: doc.number },
      });
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
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
      'inventory',
      id.toLowerCase(),
      lock,
    );
    if (doc === null) throw notFound();
    this.stores.inScope(doc.storeId);
    return doc;
  }

  private assertRunning(doc: DocumentRow): void {
    if (doc.status === 'posted') {
      throw new ProblemException(409, 'document_posted');
    }
    if (doc.status === 'cancelled') {
      throw new ProblemException(409, 'document_cancelled');
    }
  }

  /**
   * A running count of a writable store. Entries share the header (many tablets at once, none
   * after a posting); a change of the lines (`exclusive`) locks it.
   */
  private async runningCount(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    exclusive = false,
  ): Promise<DocumentRow> {
    const doc = await this.visible(trx, tenantId, id, exclusive);
    if (!exclusive) await this.counts.shareHeader(trx, tenantId, doc.id);
    const current = exclusive ? doc : await this.read(trx, tenantId, doc.id);
    this.assertRunning(current);
    await this.stores.writableStore(trx, tenantId, current.storeId);
    return current;
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<DocumentRow> {
    const doc = await this.documents.findDocument(
      trx,
      tenantId,
      'inventory',
      id,
    );
    if (doc === null)
      throw new Error('The document just written is not readable');
    return doc;
  }

  private async foundLine(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
    lineId: string,
  ): Promise<CountLineRow> {
    const line = (await this.counts.lines(trx, tenantId, doc.id)).find(
      (l) => l.id === lineId.toLowerCase() && l.isFound,
    );
    if (!line) throw notFound();
    return line;
  }

  private async lineOf(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
    lineId: string,
  ): Promise<StockCountLine> {
    // one line only: an entry is a scanner tap on a count of thousands of lines
    const [line] = await this.lineDtos(trx, tenantId, doc, lineId);
    if (!line) throw badField('lineId', 'unknown');
    return line;
  }

  private async categoryNames(
    trx: TenantTransaction,
    tenantId: string,
    docs: readonly DocumentRow[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        docs.flatMap((d) =>
          d.inventoryCategoryId ? [d.inventoryCategoryId] : [],
        ),
      ),
    ];
    return this.products.categoryNames(trx, tenantId, ids);
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

  async toDto(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<StockCount> {
    const stores = await this.inventory.storeNames(trx, tenantId, [
      doc.storeId,
    ]);
    const categories = await this.categoryNames(trx, tenantId, [doc]);
    return {
      id: doc.id,
      number: doc.number,
      status: STATUS[doc.status],
      startedAt: (doc.inventoryStartedAt as Date).toISOString(),
      storeId: doc.storeId,
      storeName: stores.get(doc.storeId) ?? '—',
      scope: doc.inventoryScope ?? 'all',
      categoryId: doc.inventoryCategoryId,
      categoryName: categories.get(doc.inventoryCategoryId ?? '') ?? null,
      comment: doc.comment ?? '',
      lines: await this.lineDtos(trx, tenantId, doc),
      createdBy: (await this.author(
        trx,
        tenantId,
        doc.createdBy,
        doc.createdAt,
      )) as DocumentAuthor,
      postedBy: await this.author(trx, tenantId, doc.postedBy, doc.postedAt),
      cancelledBy: await this.author(
        trx,
        tenantId,
        doc.cancelledBy,
        doc.cancelledAt,
      ),
    };
  }

  /** The lines of the count as the employee sees them; `lineId` — that line only. */
  private async lineDtos(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
    lineId?: string,
  ): Promise<StockCountLine[]> {
    const { employeeId } = requirePrincipal();
    const canSeeCost = this.canSeeCost();
    const lines = await this.counts.lines(trx, tenantId, doc.id, lineId);
    const entries = await this.counts.entries(trx, tenantId, doc.id, lineId);
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const byLine = new Map<string, CountEntryRow[]>();
    for (const entry of entries) {
      byLine.set(entry.lineId, [...(byLine.get(entry.lineId) ?? []), entry]);
    }
    const posted = doc.status === 'posted';
    return lines.map((line): StockCountLine => {
      const product = products.get(line.productId);
      const ppp = product?.piecesPerPack ?? 1;
      const own = byLine.get(line.id) ?? [];
      const counted = posted ? line.countedQtyPieces !== null : own.length > 0;
      const fact = posted
        ? line.countedQtyPieces
        : counted
          ? own.reduce((sum, e) => sum + e.qtyPieces, 0)
          : null;
      // sold before the count of the line (book − stock at its first entry) moves the expected
      // stock; sold after it was counted is shown only (K2). Only the POS moves the frozen batches;
      // both are fixed at the posting.
      // fixed at the posting or the cancel (a count cancelled before the values were fixed is
      // still computed live)
      const fixed =
        posted ||
        (doc.status === 'cancelled' && line.soldSinceStartPieces !== null);
      const atFirst = line.stockAtFirstEntryPieces ?? line.stockPieces;
      const sold = line.isFound
        ? 0
        : fixed
          ? (line.soldSinceStartPieces ?? 0)
          : line.bookQtyPieces - atFirst;
      const soldAfter = line.isFound
        ? 0
        : fixed
          ? (line.soldAfterCountPieces ?? 0)
          : atFirst - line.stockPieces;
      const surplusPrice =
        line.surplusPurchasePricePerPackDirams === null
          ? null
          : Number(line.surplusPurchasePricePerPackDirams);
      const pieceCost =
        line.costPerPieceDirams !== null
          ? Number(line.costPerPieceDirams)
          : surplusPrice === null
            ? 0
            : Math.ceil(surplusPrice / ppp);
      return {
        lineId: line.id,
        productId: line.productId,
        productName: product?.name ?? '',
        barcodes: product?.barcodes ?? [],
        isFound: line.isFound,
        batchId: line.batchId ?? line.surplusBatchId,
        batchNumber: line.lotNumber ?? '',
        expiresOn: line.expiryDate,
        piecesPerPack: ppp,
        bookPieces: line.bookQtyPieces,
        soldBeforeCountPieces: sold,
        soldAfterCountPieces: soldAfter,
        counted,
        factPieces: fact,
        entries: own.map((e) => ({
          id: e.id,
          pieces: e.qtyPieces,
          byName: e.enteredByName,
          mine: e.enteredBy === employeeId,
          at: e.enteredAt.toISOString(),
        })),
        ...(canSeeCost ? { pieceCostMinor: pieceCost } : {}),
        ...(canSeeCost && line.isFound ? { costMinor: surplusPrice } : {}),
      };
    });
  }
}
