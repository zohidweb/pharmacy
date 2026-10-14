import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface SalesOfDay {
  storeId: string;
  /** YYYY-MM-DD — the business date of the sales. */
  businessDate: string;
  receipts: number;
  /** The sum of the receipts, discounts applied. */
  salesMinor: number;
}

// The sales of the stores by business date, for the home and the reports (spec
// 2026-10-14-owner-cabinet, E2).
@Injectable()
export class SalesFigures {
  async byStoreDay(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<SalesOfDay[]> {
    if (storeIds.length === 0) return [];
    const result = await sql<{
      storeId: string;
      businessDate: string;
      receipts: number;
      salesMinor: string;
    }>`
      select store_id, business_date::text as business_date, count(*)::integer as receipts,
             sum(total_dirams) as sales_minor
      from pharmacy.receipts
      where tenant_id = ${tenantId}
        and store_id = any(${sql.val([...storeIds])}::uuid[])
        and business_date between ${from}::date and ${to}::date
      group by store_id, business_date`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      salesMinor: Number(row.salesMinor),
    }));
  }
}
