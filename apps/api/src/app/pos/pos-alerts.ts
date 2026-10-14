import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface ShiftWithDiscrepancy {
  shiftId: string;
  storeId: string;
  number: string;
  discrepancyMinor: number;
  closedAt: Date;
}

export interface ShortfallsOfDay {
  storeId: string;
  /** YYYY-MM-DD — the business date of the sales. */
  businessDate: string;
  /** Receipt lines of the day sold with less stock than sold. */
  lines: number;
}

// The POS events of the notifications (spec 2026-10-14-owner-cabinet, 5.4): shifts closed with a
// cash discrepancy and sales into minus. The notifications module reads them after a moment and
// keeps one notification per shift and per store × business date.
@Injectable()
export class PosAlerts {
  async closedShiftsWithDiscrepancy(
    trx: TenantTransaction,
    tenantId: string,
    after: Date,
  ): Promise<ShiftWithDiscrepancy[]> {
    const result = await sql<
      ShiftWithDiscrepancy & { discrepancyMinor: string }
    >`
      select id as shift_id, store_id, number, discrepancy_dirams as discrepancy_minor, closed_at
      from pharmacy.shifts
      where tenant_id = ${tenantId} and status = 'closed'
        and coalesce(discrepancy_dirams, 0) <> 0 and closed_at > ${after}
      order by closed_at`.execute(trx);
    return result.rows.map((row) => ({
      ...row,
      discrepancyMinor: Number(row.discrepancyMinor),
    }));
  }

  /**
   * The days with sales into minus among the receipts received after `after`: for each store ×
   * business date, every line of that day sold into minus (not only the new ones).
   */
  async shortfallsByDay(
    trx: TenantTransaction,
    tenantId: string,
    after: Date,
  ): Promise<ShortfallsOfDay[]> {
    const result = await sql<ShortfallsOfDay>`
      with affected as (
        select distinct store_id, business_date
        from pharmacy.receipts
        where tenant_id = ${tenantId} and received_at > ${after}
          and 'stock' = any(discrepancy_kinds)
      )
      select r.store_id, r.business_date::text as business_date, count(*)::integer as lines
      from pharmacy.receipts r
      join affected a on a.store_id = r.store_id and a.business_date = r.business_date
      join pharmacy.receipt_lines l on l.tenant_id = r.tenant_id and l.receipt_id = r.id
      where r.tenant_id = ${tenantId} and l.shortfall_pieces > 0
      group by r.store_id, r.business_date`.execute(trx);
    return result.rows;
  }
}
