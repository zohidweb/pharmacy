import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface RefundsOfDay {
  storeId: string;
  /** YYYY-MM-DD — the business date of the returns. */
  businessDate: string;
  refundMinor: number;
}

// The money given back to the customers by store and business date of the return, for the home and
// the reports (spec 2026-10-14-owner-cabinet, E2).
@Injectable()
export class ReturnFigures {
  async byStoreDay(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<RefundsOfDay[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      storeId: string;
      businessDate: string;
      refundMinor: string;
    }>`
      select store_id, business_date::text as business_date, sum(refund_dirams) as refund_minor
      from pharmacy.customer_returns
      where tenant_id = ${tenantId}
        and store_id = any(${sql.val([...storeIds])}::uuid[])
        and business_date between ${from}::date and ${to}::date
      group by store_id, business_date`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      refundMinor: Number(row.refundMinor),
    }));
  }
}
