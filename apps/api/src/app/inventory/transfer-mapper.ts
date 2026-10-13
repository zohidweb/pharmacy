import { Injectable } from '@nestjs/common';
import type {
  DocumentAuthor,
  Transfer,
  TransferListItem,
  TransferRequest,
  TransferRequestStatus,
  TransferStatus,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import { ProductsReader } from '../catalog/products-reader';
import type { DocumentRow } from './documents.repository';
import { InventoryRepository } from './inventory.repository';
import { type OverviewRow, TransfersRepository } from './transfers.repository';

/** `received` of the table is «accepted» of the contract. */
export const transferStatus = (status: string): TransferStatus =>
  status === 'received' ? 'accepted' : (status as TransferStatus);

/** A quantity of a line in pieces → in its unit. */
const inUnit = (
  pieces: number,
  unit: 'pack' | 'piece',
  piecesPerPack: number,
) => (unit === 'piece' ? pieces : Math.round(pieces / piecesPerPack));

// Requests and transfers in the shape of the contract (spec 2026-10-12-supplier-returns-transfers,
// section 6): names of stores, products and employees, the transfer of a request and the
// write-off of a shortage.
@Injectable()
export class TransferMapper {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly lines: TransfersRepository,
    private readonly products: ProductsReader,
  ) {}

  async requests(
    trx: TenantTransaction,
    tenantId: string,
    docs: readonly DocumentRow[],
  ): Promise<TransferRequest[]> {
    if (docs.length === 0) return [];
    const ids = docs.map((d) => d.id);
    const lines = await this.lines.requestLines(trx, tenantId, ids);
    const names = await this.productNames(
      trx,
      tenantId,
      [...lines.values()].flat().map((l) => l.productId),
    );
    const stores = await this.inventory.storeNames(
      trx,
      tenantId,
      docs.flatMap((d) => [d.storeId, d.destinationStoreId as string]),
    );
    const transfers = await this.lines.transfersOfRequests(trx, tenantId, ids);
    return docs.map((d) => ({
      id: d.id,
      number: d.number,
      date: d.documentDate,
      requesterStoreId: d.storeId,
      requesterStoreName: stores.get(d.storeId) ?? '—',
      fromStoreId: d.destinationStoreId as string,
      fromStoreName: stores.get(d.destinationStoreId as string) ?? '—',
      status: d.status as TransferRequestStatus,
      lines: (lines.get(d.id) ?? []).map((l) => ({
        productId: l.productId,
        productName: names.get(l.productId) ?? '',
        quantity: Math.round(l.qtyRequestedPieces / l.piecesPerPack),
      })),
      comment: d.comment ?? '',
      rejection: d.rejectionReason
        ? {
            reason: d.rejectionReason as NonNullable<
              TransferRequest['rejection']
            >['reason'],
            comment: d.rejectionComment ?? '',
          }
        : null,
      transferId: transfers.get(d.id)?.id ?? null,
      transferNumber: transfers.get(d.id)?.number ?? null,
    }));
  }

  async transfer(
    trx: TenantTransaction,
    tenantId: string,
    doc: DocumentRow,
  ): Promise<Transfer> {
    const lines = await this.lines.transferLines(trx, tenantId, doc.id);
    const names = await this.productNames(
      trx,
      tenantId,
      lines.map((l) => l.productId),
    );
    const receiverId = doc.destinationStoreId as string;
    const stores = await this.inventory.storeNames(trx, tenantId, [
      doc.storeId,
      receiverId,
    ]);
    const employees = await this.inventory.employeeNames(
      trx,
      tenantId,
      [doc.dispatchedBy, doc.receivedBy].flatMap((id) => (id ? [id] : [])),
    );
    const author = (
      id: string | null,
      at: Date | null,
    ): DocumentAuthor | null =>
      id && at
        ? { name: employees.get(id) ?? '—', at: at.toISOString() }
        : null;
    const request = doc.requestDocumentId
      ? ((
          await this.inventory.documentNumbers(trx, tenantId, [
            doc.requestDocumentId,
          ])
        ).get(doc.requestDocumentId) ?? null)
      : null;
    const writeOff = await this.lines.writeOffOf(trx, tenantId, doc.id);
    return {
      id: doc.id,
      number: doc.number,
      date: doc.documentDate,
      requestId: doc.requestDocumentId,
      requestNumber: request,
      fromStoreId: doc.storeId,
      fromStoreName: stores.get(doc.storeId) ?? '—',
      toStoreId: receiverId,
      toStoreName: stores.get(receiverId) ?? '—',
      status: transferStatus(doc.status),
      lines: lines.map((l) => ({
        productId: l.productId,
        productName: names.get(l.productId) ?? '',
        batchId: l.sourceBatchId,
        batchNumber: l.lotNumber ?? '',
        expiresOn: l.expiryDate,
        unit: l.unit,
        sentQuantity: inUnit(l.qtySentPieces, l.unit, l.piecesPerPack),
        receivedQuantity:
          l.qtyReceivedPieces === null
            ? null
            : inUnit(l.qtyReceivedPieces, l.unit, l.piecesPerPack),
      })),
      sentBy: author(doc.dispatchedBy, doc.dispatchedAt),
      receivedBy: author(doc.receivedBy, doc.receivedAt),
      discrepancy: writeOff
        ? {
            comment: doc.receivedComment ?? '',
            writeOffId: writeOff.id,
            writeOffNumber: writeOff.number,
          }
        : null,
    };
  }

  async listItems(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly OverviewRow[],
  ): Promise<TransferListItem[]> {
    const stores = await this.inventory.storeNames(
      trx,
      tenantId,
      rows.flatMap((r) => [r.storeId, r.destinationStoreId as string]),
    );
    const employees = await this.inventory.employeeNames(
      trx,
      tenantId,
      rows.flatMap((r) => (r.dispatchedBy ? [r.dispatchedBy] : [])),
    );
    const requests = await this.inventory.documentNumbers(
      trx,
      tenantId,
      rows.flatMap((r) => (r.requestDocumentId ? [r.requestDocumentId] : [])),
    );
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.documentDate,
      fromStoreId: r.storeId,
      fromStoreName: stores.get(r.storeId) ?? '—',
      toStoreId: r.destinationStoreId as string,
      toStoreName: stores.get(r.destinationStoreId as string) ?? '—',
      requestNumber: r.requestDocumentId
        ? (requests.get(r.requestDocumentId) ?? null)
        : null,
      positions: r.positions,
      status: transferStatus(r.status),
      sentByName: r.dispatchedBy
        ? (employees.get(r.dispatchedBy) ?? '—')
        : null,
      shortage: r.writeOffId !== null,
    }));
  }

  private async productNames(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    return new Map(
      (await this.products.findForStock(trx, tenantId, unique)).map((p) => [
        p.id,
        p.name,
      ]),
    );
  }
}
