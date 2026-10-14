import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { PurchasingRepository } from './purchasing.repository';

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
}
