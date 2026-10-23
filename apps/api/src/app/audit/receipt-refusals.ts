import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { zoneOf } from './network-zone';

/** The sales refused at a store on a business date (YYYY-MM-DD): the ids the POS gave them. */
export interface RefusedReceiptsOfDay {
  storeId: string;
  businessDate: string;
  receiptIds: string[];
}

// The sales the price rules of the POS refused (security review 2026-10-22, I2; ADR-0015, amendment 2026-10-23): no
// receipt is written, only `receipt.refused` in the journal, so the owner's notification counts them from here with
// the receipts of the day marked for the price, the discount or the author. The business date is the date of the
// refusal in the time zone of the network. Read in the caller's transaction, by audit_log_recorded_idx.
@Injectable()
export class ReceiptRefusals {
  /** The store × business dates of the refusals recorded after `after`. */
  async days(
    trx: TenantTransaction,
    tenantId: string,
    after: Date,
  ): Promise<Array<{ storeId: string; businessDate: string }>> {
    const result = await sql<{ storeId: string; businessDate: string }>`
      select distinct a.store_id, (a.recorded_at at time zone ${zoneOf(tenantId)})::date::text as business_date
      from pharmacy.audit_log a
      where a.tenant_id = ${tenantId} and a.recorded_at > ${after}
        and a.action = 'receipt.refused' and a.store_id is not null`.execute(
      trx,
    );
    return result.rows;
  }

  /** Every sale refused on those days. */
  async receipts(
    trx: TenantTransaction,
    tenantId: string,
    days: ReadonlyArray<{ storeId: string; businessDate: string }>,
  ): Promise<RefusedReceiptsOfDay[]> {
    if (days.length === 0) return [];
    const dates = days.map((d) => d.businessDate).sort();
    const result = await sql<RefusedReceiptsOfDay>`
      with refused as (
        select a.store_id, (a.recorded_at at time zone ${zoneOf(tenantId)})::date as business_date, a.entity_id
        from pharmacy.audit_log a
        where a.tenant_id = ${tenantId} and a.action = 'receipt.refused'
          and a.recorded_at >= ${dates[0]}::date - interval '1 day'
          and a.recorded_at < ${dates[dates.length - 1]}::date + interval '2 days'
      )
      select r.store_id, r.business_date::text as business_date,
             array_agg(distinct r.entity_id::text) as receipt_ids
      from refused r
      join unnest(${sql.val(days.map((d) => d.storeId))}::uuid[],
                  ${sql.val(days.map((d) => d.businessDate))}::date[]) as d(store_id, business_date)
        on d.store_id = r.store_id and d.business_date = r.business_date
      group by r.store_id, r.business_date`.execute(trx);
    return result.rows;
  }
}
