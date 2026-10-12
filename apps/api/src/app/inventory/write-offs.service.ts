import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  DocumentAuthor,
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
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { type DocumentRow, DocumentsRepository } from './documents.repository';
import {
  InventoryRepository,
  type StoreForWrite,
} from './inventory.repository';
import { Numbering } from './numbering';
import { StockRepository } from './stock.repository';
import { totalOf, WriteOffPosting } from './write-off-posting';
import {
  type WriteOffLineValues,
  WriteOffsRepository,
} from './write-offs.repository';

const DAY_MS = 86_400_000;
const notFound = () => new ProblemException(404, 'not_found');
const badLine = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

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
  ) {}

  async list(query: WriteOffListQuery): Promise<WriteOffListResponse> {
    const { tenantId } = requirePrincipal();
    const canSeeCost = this.canSeeCost();
    const scope = this.scope();
    const storeId = query.storeId?.toLowerCase();
    if (storeId) this.inScope(storeId);
    const storeIds = storeId ? [storeId] : scope;
    const limit = query.limit ?? 20;
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
      const batches = (
        await this.stock.batchStock(trx, tenantId, active, null)
      ).filter((b) => b.qty > 0);
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
          status: r.status,
        })),
        total,
        limit,
        offset,
        kpi: {
          documentsThisMonth: month.documents,
          ...(canSeeCost
            ? { writtenOffThisMonthMinor: Number(month.amountDirams) }
            : {}),
          expiredBatches: batches.filter((b) => b.expiryDate < settings.today)
            .length,
          expiringBatches: batches.filter(
            (b) => b.expiryDate >= settings.today && b.expiryDate <= soon,
          ).length,
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

  /** Only a draft: 409 `document_posted`. */
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
      const store = await this.writableStore(trx, tenantId, doc.storeId);
      await this.posting.post(trx, { tenantId, employeeId }, doc, store);
      return this.toDto(trx, tenantId, await this.read(trx, tenantId, doc.id));
    });
  }

  async unpost(id: string): Promise<WriteOff> {
    const { tenantId, employeeId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const doc = await this.visible(trx, tenantId, id, true);
      const store = await this.writableStore(trx, tenantId, doc.storeId);
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
    this.inScope(doc.storeId);
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
      'write_off',
      id,
    );
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
    id: string,
    current: DocumentRow | null,
    input: WriteOffInput,
  ): Promise<void> {
    const { employeeId } = requirePrincipal();
    const storeId = input.storeId.toLowerCase();
    if (current !== null && current.storeId !== storeId) {
      throw badLine('storeId', 'immutable');
    }
    const store = await this.writableStore(trx, tenantId, storeId);
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
      if (
        !batch ||
        !product ||
        batch.storeId !== storeId ||
        batch.productId !== product.id
      ) {
        throw badLine(`lines.${i}.batchId`, 'unknown_batch');
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
      status: doc.status,
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
    };
  }
}
