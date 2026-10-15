import { Injectable } from '@nestjs/common';
import { supplierDebt } from '@pharmacy/shared-domain';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { PurchasingRepository } from './purchasing.repository';

export interface SupplierDebtOfToday {
  supplierId: string;
  supplierName: string;
  debtMinor: number;
  overdueMinor: number;
  /** YYYY-MM-DD — the earliest due date of the open receipts; null without debt. */
  nextDueOn: string | null;
}

export interface SupplierDue {
  supplierId: string;
  supplierName: string;
  storeId: string;
  /** YYYY-MM-DD — the due date of the receipts (their payment due date, else their date). */
  dueDate: string;
  amountMinor: number;
}

// The supplier payments coming due, for the notifications (spec 2026-10-14-owner-cabinet, 5.4):
// posted goods receipts with a debt after the allocations of payments and returns, due by a date,
// summed by supplier × store × due date.
@Injectable()
export class SupplierDues {
  constructor(private readonly repository: PurchasingRepository) {}

  async dueByStore(
    trx: TenantTransaction,
    tenantId: string,
    untilDate: string,
    storeIds?: readonly string[],
  ): Promise<SupplierDue[]> {
    const stores = storeIds === undefined ? null : new Set(storeIds);
    const receipts = await this.repository.postedReceipts(trx, tenantId, null);
    const dues = new Map<string, SupplierDue>();
    for (const receipt of receipts) {
      const debt =
        Number(receipt.totalDirams) - Number(receipt.allocatedDirams);
      const dueDate = receipt.dueDate ?? receipt.documentDate;
      if (debt <= 0 || dueDate > untilDate) continue;
      if (stores !== null && !stores.has(receipt.storeId)) continue;
      const key = `${receipt.supplierId}/${receipt.storeId}/${dueDate}`;
      const due = dues.get(key) ?? {
        supplierId: receipt.supplierId,
        supplierName: '',
        storeId: receipt.storeId,
        dueDate,
        amountMinor: 0,
      };
      due.amountMinor += debt;
      dues.set(key, due);
    }
    if (dues.size === 0) return [];
    const supplierIds = [
      ...new Set([...dues.values()].map((d) => d.supplierId)),
    ];
    const names = await sql<{ id: string; name: string }>`
      select id, name from pharmacy.suppliers
      where tenant_id = ${tenantId} and id = any(${sql.val(supplierIds)}::uuid[])`.execute(
      trx,
    );
    const nameOf = new Map(names.rows.map((row) => [row.id, row.name]));
    return [...dues.values()].map((due) => ({
      ...due,
      supplierName: nameOf.get(due.supplierId) ?? '—',
    }));
  }

  /**
   * The debts to the suppliers today by the posted receipts of the stores (all stores without
   * them), as the supplier list counts them (spec 2026-10-14-owner-cabinet, E18).
   */
  /**
   * What a closing store leaves with the suppliers (spec 2026-10-15-store-closing, E8): its purchase
   * orders not closed, and its posted receipts not paid in full with the amount still due.
   */
  async openOfStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<{ openOrders: number; unpaidReceipts: number; unpaidMinor: number }> {
    const orders = await sql<{ open: number }>`
      select count(*)::integer as open from pharmacy.purchase_orders
      where tenant_id = ${tenantId} and store_id = ${storeId} and status <> 'closed'`.execute(trx);
    const unpaid = (await this.repository.postedReceipts(trx, tenantId, null))
      .filter((receipt) => receipt.storeId === storeId)
      .map(
        (receipt) =>
          Number(receipt.totalDirams) - Number(receipt.allocatedDirams),
      )
      .filter((debt) => debt > 0);
    return {
      openOrders: orders.rows[0].open,
      unpaidReceipts: unpaid.length,
      unpaidMinor: unpaid.reduce((sum, debt) => sum + debt, 0),
    };
  }

  async debts(
    trx: TenantTransaction,
    tenantId: string,
    today: string,
    storeIds?: readonly string[],
  ): Promise<SupplierDebtOfToday[]> {
    const stores = storeIds === undefined ? null : new Set(storeIds);
    const receipts = (
      await this.repository.postedReceipts(trx, tenantId, null)
    ).filter((receipt) => stores === null || stores.has(receipt.storeId));
    const bySupplier = new Map<string, typeof receipts>();
    for (const receipt of receipts) {
      bySupplier.set(receipt.supplierId, [
        ...(bySupplier.get(receipt.supplierId) ?? []),
        receipt,
      ]);
    }
    if (bySupplier.size === 0) return [];
    const names = await sql<{ id: string; name: string }>`
      select id, name from pharmacy.suppliers
      where tenant_id = ${tenantId}
        and id = any(${sql.val([...bySupplier.keys()])}::uuid[])`.execute(trx);
    const nameOf = new Map(names.rows.map((row) => [row.id, row.name]));
    return [...bySupplier].map(([supplierId, ofSupplier]) => {
      const debt = supplierDebt(
        ofSupplier
          .map((receipt) => ({
            document: receipt.number,
            dueOn: receipt.dueDate ?? receipt.documentDate,
            amountMinor:
              Number(receipt.totalDirams) - Number(receipt.allocatedDirams),
          }))
          .filter((invoice) => invoice.amountMinor > 0),
        0,
        today,
      );
      return {
        supplierId,
        supplierName: nameOf.get(supplierId) ?? '—',
        debtMinor: debt.debtMinor,
        overdueMinor: debt.overdueMinor,
        nextDueOn: debt.nextDueOn,
      };
    });
  }
}
