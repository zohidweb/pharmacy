import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** A change of the payment QR link of a store, as the journal keeps it. */
export interface PaymentQrChange {
  /** The journal entry: one notification per change. */
  auditId: string;
  storeId: string;
  storeName: string;
  /** null — no employee (a system change). */
  employeeName: string | null;
}

// The changes of the payment QR links of the network for the owner's notification (spec 2026-11-03-pos-store-ideas,
// D38): `store.payment_qr_changed` is written once per change (StoresService.updatePaymentQr), the link decides where
// the buyers' money goes, so every change is told. Read in the caller's transaction, by audit_log_recorded_idx; every
// join keeps the tenant of the entry.
@Injectable()
export class PaymentQrChanges {
  /** The changes recorded after `after`, the oldest first. */
  async changedSince(
    trx: TenantTransaction,
    tenantId: string,
    after: Date,
  ): Promise<PaymentQrChange[]> {
    const result = await sql<PaymentQrChange>`
      select a.id::text as audit_id, a.store_id::text as store_id, coalesce(s.name, '') as store_name,
             e.full_name as employee_name
      from pharmacy.audit_log a
      left join pharmacy.stores s on s.tenant_id = a.tenant_id and s.id = a.store_id
      left join pharmacy.employees e on e.tenant_id = a.tenant_id and e.id = a.employee_id
      where a.tenant_id = ${tenantId} and a.recorded_at > ${after}
        and a.action = 'store.payment_qr_changed' and a.store_id is not null
      order by a.recorded_at, a.id`.execute(trx);
    return result.rows;
  }
}
