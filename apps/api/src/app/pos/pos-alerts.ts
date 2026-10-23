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

/** A store × business date (YYYY-MM-DD). */
export interface StoreDay {
  storeId: string;
  businessDate: string;
}

/** The receipts of a store × business date with a price, discount or author mark. */
export interface MarkedReceiptsOfDay extends StoreDay {
  receiptIds: string[];
}

const DISCREPANCY_MARKS = sql`array['price', 'discount', 'author']::text[]`;

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

  /**
   * The days of the receipts received after `after` with a price, discount or author mark (security review 2026-10-22,
   * I2); `created_at` is the moment of receiving, by receipts_created_idx.
   */
  async discrepancyDays(
    trx: TenantTransaction,
    tenantId: string,
    after: Date,
  ): Promise<StoreDay[]> {
    const result = await sql<StoreDay>`
      select distinct store_id, business_date::text as business_date
      from pharmacy.receipts
      where tenant_id = ${tenantId} and created_at > ${after}
        and discrepancy_kinds && ${DISCREPANCY_MARKS}`.execute(trx);
    return result.rows;
  }

  /** Every receipt of those days with a price, discount or author mark. */
  async discrepancyReceipts(
    trx: TenantTransaction,
    tenantId: string,
    days: readonly StoreDay[],
  ): Promise<MarkedReceiptsOfDay[]> {
    if (days.length === 0) return [];
    const result = await sql<MarkedReceiptsOfDay>`
      select r.store_id, r.business_date::text as business_date,
             array_agg(r.id::text order by r.id) as receipt_ids
      from pharmacy.receipts r
      join unnest(${sql.val(days.map((d) => d.storeId))}::uuid[],
                  ${sql.val(days.map((d) => d.businessDate))}::date[]) as d(store_id, business_date)
        on d.store_id = r.store_id and d.business_date = r.business_date
      where r.tenant_id = ${tenantId} and r.discrepancy_kinds && ${DISCREPANCY_MARKS}
      group by r.store_id, r.business_date`.execute(trx);
    return result.rows;
  }
}
