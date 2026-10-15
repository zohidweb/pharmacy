import { Injectable } from '@nestjs/common';
import type { StoreClosingBlocker } from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import { ProblemException } from '../../common/errors/problem.exception';
import { newId, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { ProductsReader } from '../catalog/products-reader';
import { DocumentsRepository } from './documents.repository';
import { InventoryRepository, type StoreForWrite } from './inventory.repository';
import { Numbering } from './numbering';
import { StockFreeze } from './stock-freeze';
import { TransferPosting } from './transfer-posting';
import { TransfersRepository } from './transfers.repository';

/** The acceptance takes at most 500 lines (DTO, a request body of ≤ 100 KB): one transfer each. */
const CLOSING_LINES = 500;

/** A batch with stock of the closing store, in pieces. */
export interface ClosingStockLine {
  batchId: string;
  productId: string;
  productName: string;
  batchNumber: string;
  /** YYYY-MM-DD */
  expiresOn: string;
  qtyPieces: number;
  piecesPerPack: number;
  costPerPieceMinor: number;
}

export interface ClosingTransfer {
  id: string;
  number: string;
  status: 'in_transit' | 'received' | 'cancelled';
}

interface Balance {
  batchId: string;
  productId: string;
  batchNumber: string;
  expiresOn: string;
  cost: string;
  qty: number;
}

// The stock side of the closing of a store (spec 2026-10-15-store-closing, E5–E7, E10): what forbids
// it, the stock that leaves, the transfers of 500 lines that take it and their recall. The stores
// module decides when; the sender's status is its business, so the store is read here without the
// `active` check of StoreAccess (a closing store recalls its transfers).
@Injectable()
export class StoreClosingTransfers {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly documents: DocumentsRepository,
    private readonly lines: TransfersRepository,
    private readonly numbering: Numbering,
    private readonly products: ProductsReader,
    private readonly posting: TransferPosting,
    private readonly freeze: StockFreeze,
    private readonly audit: AuditService,
  ) {}

  /** The non-zero blockers of the stock (E7): all but `open_shift`, which the POS knows. */
  async blockers(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    today: string,
  ): Promise<StoreClosingBlocker[]> {
    const counts = await sql<{
      stockCount: number;
      incoming: number;
      outgoing: number;
      requests: number;
    }>`
      select
        count(*) filter (where d.type = 'inventory' and d.status = 'draft'
                           and d.store_id = ${storeId})::integer as stock_count,
        count(*) filter (where d.type = 'transfer' and d.status = 'in_transit'
                           and not d.store_closing
                           and d.destination_store_id = ${storeId})::integer as incoming,
        count(*) filter (where d.type = 'transfer' and d.status = 'in_transit'
                           and not d.store_closing and d.store_id = ${storeId})::integer as outgoing,
        count(*) filter (where d.type = 'transfer_request'
                           and d.status in ('draft', 'sent', 'in_progress'))::integer as requests
      from pharmacy.documents d
      where d.tenant_id = ${tenantId}
        and (d.store_id = ${storeId} or d.destination_store_id = ${storeId})`.execute(trx);
    const row = counts.rows[0];
    const negative = (await this.balances(trx, tenantId, storeId)).filter(
      (balance) => balance.qty < 0,
    ).length;
    const store = await this.inventory.store(trx, tenantId, storeId);
    const periodClosed =
      store?.closedUntil != null && store.closedUntil >= today ? 1 : 0;
    const all: StoreClosingBlocker[] = [
      { code: 'stock_count', count: row.stockCount },
      { code: 'incoming_transfer', count: row.incoming },
      { code: 'outgoing_transfer', count: row.outgoing },
      { code: 'transfer_request', count: row.requests },
      { code: 'negative_stock', count: negative },
      { code: 'period_closed', count: periodClosed },
    ];
    return all.filter((blocker) => blocker.count > 0);
  }

  /** The drafts of the stock documents of the store (E8): they stay drafts. */
  async draftDocuments(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<number> {
    const result = await sql<{ drafts: number }>`
      select count(*)::integer as drafts from pharmacy.documents
      where tenant_id = ${tenantId} and store_id = ${storeId} and status = 'draft'
        and type not in ('inventory', 'transfer_request')`.execute(trx);
    return result.rows[0].drafts;
  }

  /** The batches with a positive stock, by product name, expiry and lot. */
  async stock(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<ClosingStockLine[]> {
    const positive = (await this.balances(trx, tenantId, storeId)).filter(
      (balance) => balance.qty > 0,
    );
    if (positive.length === 0) return [];
    const products = new Map(
      (
        await this.products.findForStock(trx, tenantId, [
          ...new Set(positive.map((balance) => balance.productId)),
        ])
      ).map((product) => [product.id, product]),
    );
    return positive
      .map((balance) => {
        const product = products.get(balance.productId);
        return {
          batchId: balance.batchId,
          productId: balance.productId,
          productName: product?.name ?? '—',
          batchNumber: balance.batchNumber,
          expiresOn: balance.expiresOn,
          qtyPieces: balance.qty,
          piecesPerPack: product?.piecesPerPack ?? 1,
          costPerPieceMinor: Number(balance.cost),
        };
      })
      .sort(
        (a, b) =>
          a.productName.localeCompare(b.productName, 'ru') ||
          a.expiresOn.localeCompare(b.expiresOn) ||
          a.batchNumber.localeCompare(b.batchNumber) ||
          a.batchId.localeCompare(b.batchId),
      );
  }

  /**
   * The whole stock to the receiver by transfers of 500 lines, sent today (E5, E6): whole packs in
   * packs, an opened pack in pieces. The caller has checked both stores and the blockers.
   */
  async send(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    storeId: string,
    receiverStoreId: string,
  ): Promise<{ id: string; number: string }[]> {
    const { tenantId, employeeId } = ctx;
    const sender = await this.sender(trx, tenantId, storeId);
    const stock = await this.stock(trx, tenantId, storeId);
    const today = (await this.inventory.settings(trx, tenantId)).today;
    const sent: { id: string; number: string }[] = [];
    for (let start = 0; start < stock.length; start += CLOSING_LINES) {
      const chunk = stock.slice(start, start + CLOSING_LINES);
      const id = newId();
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
        {
          storeId,
          documentDate: today,
          comment: null,
          totalDirams: 0,
          supplierId: null,
          supplierInvoiceNumber: null,
          paymentDueDate: null,
          purchaseOrderId: null,
          destinationStoreId: receiverStoreId,
          requestDocumentId: null,
          storeClosing: true,
        },
      );
      // as a transfer sent at once: the stock of the store, then the batches, before the lines
      await this.freeze.lockShared(trx, tenantId, storeId);
      await this.documents.lockBatches(
        trx,
        tenantId,
        chunk.map((line) => line.batchId),
      );
      await this.lines.replaceTransferLines(
        trx,
        tenantId,
        id,
        chunk.map((line) => ({
          sourceBatchId: line.batchId,
          productId: line.productId,
          unit: line.qtyPieces % line.piecesPerPack === 0 ? 'pack' : 'piece',
          qtySentPieces: line.qtyPieces,
        })),
      );
      await this.audit.append(trx, {
        action: 'document.created',
        entityType: 'document',
        entityId: id,
        storeId,
        details: {
          type: 'transfer',
          toStoreId: receiverStoreId,
          requestId: null,
          lines: chunk.length,
          storeClosing: true,
        },
      });
      const doc = await this.documents.findDocument(
        trx,
        tenantId,
        'transfer',
        id,
      );
      if (doc === null) throw new Error('The transfer just written is not readable');
      await this.posting.send(trx, ctx, doc, sender);
      sent.push({ id, number });
    }
    return sent;
  }

  /** The store whose closing made the transfer; null — an ordinary transfer. */
  async storeOfTransfer(
    trx: TenantTransaction,
    tenantId: string,
    transferId: string,
  ): Promise<string | null> {
    const result = await sql<{ storeId: string }>`
      select store_id from pharmacy.documents
      where tenant_id = ${tenantId} and id = ${transferId} and store_closing`.execute(trx);
    return result.rows[0]?.storeId ?? null;
  }

  /** The transfers of the closing of the store, by number. */
  async transfers(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<ClosingTransfer[]> {
    const result = await sql<ClosingTransfer>`
      select id, number, status from pharmacy.documents
      where tenant_id = ${tenantId} and store_id = ${storeId} and store_closing
      order by number`.execute(trx);
    return result.rows;
  }

  /**
   * Recalls and cancels the transfers of the closing in transit (E10); 409 `closing_partly_received`
   * once one is accepted. Returns their numbers.
   */
  async cancel(
    trx: TenantTransaction,
    ctx: { tenantId: string; employeeId: string },
    storeId: string,
  ): Promise<string[]> {
    const { tenantId, employeeId } = ctx;
    const transfers = await this.transfers(trx, tenantId, storeId);
    if (transfers.some((transfer) => transfer.status === 'received')) {
      throw new ProblemException(409, 'closing_partly_received');
    }
    const sender = await this.sender(trx, tenantId, storeId);
    const recalled: string[] = [];
    for (const transfer of transfers) {
      if (transfer.status !== 'in_transit') continue;
      const doc = await this.documents.findDocument(
        trx,
        tenantId,
        'transfer',
        transfer.id,
        true,
      );
      if (doc === null || doc.status !== 'in_transit') {
        throw new ProblemException(409, 'transfer_not_in_transit');
      }
      await this.posting.recall(trx, ctx, doc, sender);
      await this.documents.markCancelled(trx, tenantId, doc.id, employeeId);
      await this.audit.append(trx, {
        action: 'transfer.cancelled',
        entityType: 'document',
        entityId: doc.id,
        storeId,
        details: { number: doc.number },
      });
      recalled.push(doc.number);
    }
    return recalled;
  }

  /** The closing store, cloud only; its status is checked by the stores module. */
  private async sender(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<StoreForWrite> {
    const store = await this.inventory.store(trx, tenantId, storeId);
    if (store === null) throw new ProblemException(404, 'not_found');
    if (store.mode !== 'online') {
      throw new ProblemException(409, 'offline_store_read_only');
    }
    return store;
  }

  /** The non-zero stock of every batch of the store, one pass over its movements. */
  private async balances(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<Balance[]> {
    const result = await sql<Balance>`
      select b.id as batch_id, b.product_id, coalesce(b.lot_number, '') as batch_number,
             b.expiry_date::text as expires_on, b.cost_per_piece_dirams as cost,
             sum(m.qty_delta_pieces)::integer as qty
      from pharmacy.stock_movements m
      join pharmacy.batches b on b.tenant_id = m.tenant_id and b.id = m.batch_id
      where m.tenant_id = ${tenantId} and m.store_id = ${storeId}
      group by b.id, b.product_id, b.lot_number, b.expiry_date, b.cost_per_piece_dirams
      having sum(m.qty_delta_pieces) <> 0`.execute(trx);
    return result.rows;
  }
}
