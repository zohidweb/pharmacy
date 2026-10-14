import { Injectable } from '@nestjs/common';
import type { NotificationKind } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import { StockAlerts } from '../inventory/stock-alerts';
import { PosAlerts } from '../pos/pos-alerts';
import { SupplierDues } from '../purchasing/supplier-dues';
import {
  type NewNotification,
  NotificationsRepository,
} from './notifications.repository';

const REFRESH_MS = 5 * 60_000;
// a receipt committed a little after the moment of the last refresh is not lost: the keys make a
// repeat harmless
const EVENTS_OVERLAP_MS = 5 * 60_000;
// a closing sent from the buffer carries the time of the device: look back two days
const SHIFT_LOOKBACK_MS = 2 * 86_400_000;

const addDays = (date: string, days: number) => {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
};

// The notifications are refreshed on read (spec 2026-10-14-owner-cabinet, E11): the API has no
// background jobs. A refresh runs when the last one is older than 5 minutes or the settings changed
// after it, one per network at a time. States are created, updated and resolved; events are read
// from the facts that came after the previous refresh.
@Injectable()
export class NotificationsRefresh {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly stock: StockAlerts,
    private readonly dues: SupplierDues,
    private readonly pos: PosAlerts,
  ) {}

  async run(trx: TenantTransaction, tenantId: string): Promise<void> {
    const context = await this.repository.context(trx, tenantId);
    const refreshedAt = context.refreshedAt?.getTime() ?? null;
    const settingsChanged =
      refreshedAt !== null &&
      context.settingsUpdatedAt !== null &&
      context.settingsUpdatedAt.getTime() > refreshedAt;
    if (
      refreshedAt !== null &&
      Date.now() - refreshedAt < REFRESH_MS &&
      !settingsChanged
    ) {
      return;
    }
    if (!(await this.repository.tryLock(trx, tenantId))) return;
    const startedAt = new Date();
    const enabled = (kind: NotificationKind) =>
      !context.disabled.includes(kind);
    const stores = await this.repository.storeNames(trx, tenantId);
    const storeName = (id: string) => stores.get(id) ?? '—';

    if (enabled('batch_expiring')) {
      const batches = await this.stock.expiringBatches(
        trx,
        tenantId,
        context.expiryDays,
      );
      await this.state(
        trx,
        tenantId,
        'batch_expiring',
        batches.map((batch) => ({
          kind: 'batch_expiring',
          storeId: batch.storeId,
          dedupeKey: `batch_expiring:${batch.batchId}`,
          entityType: 'batch',
          entityId: batch.batchId,
          params: {
            productNames: batch.productName,
            batchNumber: batch.lotNumber ?? '',
            expiresOn: batch.expiryDate,
            quantity: Math.floor(batch.qtyPieces / batch.piecesPerPack),
            storeName: storeName(batch.storeId),
          },
        })),
      );
    }
    if (enabled('low_stock')) {
      const low = await this.stock.lowStock(trx, tenantId);
      await this.state(
        trx,
        tenantId,
        'low_stock',
        low.map((store) => ({
          kind: 'low_stock',
          storeId: store.storeId,
          dedupeKey: `low_stock:${store.storeId}`,
          entityType: 'store',
          entityId: store.storeId,
          params: {
            positions: store.positions,
            storeName: storeName(store.storeId),
          },
        })),
      );
    }
    if (enabled('supplier_payment_due')) {
      const dues = await this.dues.dueByStore(
        trx,
        tenantId,
        addDays(context.today, context.supplierDays),
      );
      await this.state(
        trx,
        tenantId,
        'supplier_payment_due',
        dues.map((due) => ({
          kind: 'supplier_payment_due',
          storeId: due.storeId,
          dedupeKey: `supplier_payment_due:${due.supplierId}:${due.storeId}:${due.dueDate}`,
          entityType: 'supplier',
          entityId: due.supplierId,
          params: {
            supplierName: due.supplierName,
            dueDate: due.dueDate,
            amountMinor: due.amountMinor,
            storeName: storeName(due.storeId),
          },
        })),
      );
    }
    if (enabled('transfer_in_transit')) {
      const transfers = await this.stock.transfersInTransit(trx, tenantId);
      await this.state(
        trx,
        tenantId,
        'transfer_in_transit',
        transfers.map((transfer) => ({
          kind: 'transfer_in_transit',
          storeId: transfer.toStoreId,
          dedupeKey: `transfer:${transfer.documentId}`,
          entityType: 'document',
          entityId: transfer.documentId,
          params: {
            documentNumber: transfer.number,
            fromStore: storeName(transfer.fromStoreId),
            toStore: storeName(transfer.toStoreId),
            positions: transfer.positions,
          },
        })),
      );
    }
    if (enabled('shift_discrepancy')) {
      const shifts = await this.pos.closedShiftsWithDiscrepancy(
        trx,
        tenantId,
        new Date(startedAt.getTime() - SHIFT_LOOKBACK_MS),
      );
      await this.repository.upsert(
        trx,
        tenantId,
        shifts.map((shift) => ({
          kind: 'shift_discrepancy',
          storeId: shift.storeId,
          dedupeKey: `shift:${shift.shiftId}`,
          entityType: 'shift',
          entityId: shift.shiftId,
          params: {
            shiftNumber: shift.number,
            amountMinor: shift.discrepancyMinor,
            storeName: storeName(shift.storeId),
          },
        })),
      );
    }
    if (enabled('negative_stock')) {
      const since = context.eventsAfter ?? startedAt;
      const days = await this.pos.shortfallsByDay(
        trx,
        tenantId,
        new Date(since.getTime() - EVENTS_OVERLAP_MS),
      );
      await this.repository.upsert(
        trx,
        tenantId,
        days.map((day) => ({
          kind: 'negative_stock',
          storeId: day.storeId,
          dedupeKey: `negative_stock:${day.storeId}:${day.businessDate}`,
          entityType: 'store',
          entityId: day.storeId,
          params: {
            positions: day.lines,
            storeName: storeName(day.storeId),
          },
        })),
      );
    }
    await this.repository.markRefreshed(trx, tenantId, startedAt);
  }

  private async state(
    trx: TenantTransaction,
    tenantId: string,
    kind: NotificationKind,
    items: NewNotification[],
  ): Promise<void> {
    await this.repository.upsert(trx, tenantId, items);
    await this.repository.resolveMissing(
      trx,
      tenantId,
      kind,
      items.map((item) => item.dedupeKey),
    );
  }
}
