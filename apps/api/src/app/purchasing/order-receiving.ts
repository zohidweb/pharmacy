import { Injectable } from '@nestjs/common';
import { orderStatusAfterReceipt } from '@pharmacy/shared-domain';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import type { TenantTransaction } from '../../core/database';
import { PurchaseOrdersRepository } from './purchase-orders.repository';

const badOrder = (code: string) =>
  new FieldProblemException(422, 'validation_failed', [
    { field: 'orderId', code },
  ]);

// The public interface of purchase orders for the stock module (ADR-0002): a goods receipt by an
// order links its lines to the order lines, and its posting or unposting recounts the order
// status (spec 2026-10-09-inventory-purchasing, section 5.3). Runs in the caller's transaction.
@Injectable()
export class OrderReceiving {
  constructor(private readonly repository: PurchaseOrdersRepository) {}

  /**
   * The order lines by product for a goods receipt; 422 validation_failed at `orderId` unless the
   * order is confirmed or partially received, of the same supplier and store.
   */
  async linesFor(
    trx: TenantTransaction,
    tenantId: string,
    orderId: string,
    supplierId: string,
    storeId: string,
  ): Promise<Map<string, { lineId: string; pricePerPackDirams: number }>> {
    const order = await this.repository.find(trx, tenantId, orderId);
    if (order === null) throw badOrder('unknown_order');
    if (order.supplierId !== supplierId)
      throw badOrder('order_supplier_mismatch');
    if (order.storeId !== storeId) throw badOrder('order_store_mismatch');
    if (order.status !== 'confirmed' && order.status !== 'partially_received') {
      throw badOrder('order_not_open');
    }
    const lines = await this.repository.lines(trx, tenantId, [order.id]);
    return new Map(
      lines.map((l) => [
        l.productId,
        { lineId: l.id, pricePerPackDirams: Number(l.pricePerPackDirams) },
      ]),
    );
  }

  /**
   * At the posting of a goods receipt by an order: the order, locked until the transaction ends, is
   * still of the supplier and the store and open — a parallel receipt may have closed it since the
   * draft was saved. 422 validation_failed at `orderId` otherwise.
   */
  async assertOpen(
    trx: TenantTransaction,
    tenantId: string,
    receipt: { orderId: string; supplierId: string | null; storeId: string },
  ): Promise<void> {
    const order = await this.repository.find(trx, tenantId, receipt.orderId, true);
    if (order === null) throw badOrder('unknown_order');
    if (order.supplierId !== receipt.supplierId)
      throw badOrder('order_supplier_mismatch');
    if (order.storeId !== receipt.storeId) throw badOrder('order_store_mismatch');
    if (order.status !== 'confirmed' && order.status !== 'partially_received') {
      throw badOrder('order_not_open');
    }
  }

  /** The status of a confirmed order after its posted goods receipts. */
  async refreshStatus(
    trx: TenantTransaction,
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const order = await this.repository.find(trx, tenantId, orderId, true);
    if (order === null || order.status === 'draft') return;
    const lines = await this.repository.lines(trx, tenantId, [order.id]);
    const received = await this.repository.receivedPieces(trx, tenantId, [
      order.id,
    ]);
    const status = orderStatusAfterReceipt(
      lines.map((l) => ({
        quantity: l.qtyOrderedPieces,
        receivedQuantity: received.get(l.id) ?? 0,
      })),
    );
    if (status !== order.status) {
      await this.repository.setStatus(trx, tenantId, order.id, status);
    }
  }

  async numbers(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    return this.repository.numbers(trx, tenantId, ids);
  }
}
