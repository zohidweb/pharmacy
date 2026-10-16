import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

// The stores an invoice bills (A2) and what it needs of them (A21), shared by the refresh of the
// activity and the owner's estimate so the two never select differently: cloud pharmacies of the
// network, their first sale ever (receipts_store_date_idx) and the business date of the closing in
// the time zone of the network. `s` is pharmacy.stores, `ts` its tenant_settings.
const billedStores = sql`
  from pharmacy.stores s
  join lateral (
    select min(r.business_date) as first_ever
    from pharmacy.receipts r
    where r.tenant_id = s.tenant_id and r.store_id = s.id
  ) e on true
  left join pharmacy.tenant_settings ts on ts.tenant_id = s.tenant_id`;
const billedWhere = (tenantId: string) =>
  sql`s.tenant_id = ${tenantId} and s.kind = 'pharmacy' and s.mode = 'online'`;
const closedOn = sql`(s.closed_at at time zone coalesce(ts.timezone, 'Asia/Dushanbe'))::date`;

// The monthly activity of the stores of a network for its invoices (spec
// 2026-10-15-billing-services, A2, A21; table store_usage_monthly, tenant-export).
@Injectable()
export class StoreUsageRepository {
  /**
   * Rewrites the activity of `month` (YYYY-MM-01) from the receipts: cloud pharmacies with at least
   * one receipt in the month, their first sale ever (receipts_store_date_idx) and the business date
   * of the closing in the time zone of the network.
   */
  async refresh(
    trx: TenantTransaction,
    tenantId: string,
    month: string,
  ): Promise<void> {
    // refreshes of one network and month run one after another (a preview beside a generation)
    await sql`select pg_advisory_xact_lock(hashtextextended(${`store-usage:${tenantId}:${month}`}, 0))`.execute(
      trx,
    );
    await sql`
      delete from pharmacy.store_usage_monthly
      where tenant_id = ${tenantId} and month = ${month}::date`.execute(trx);
    await sql`
      insert into pharmacy.store_usage_monthly
        (tenant_id, store_id, month, receipts_count, first_sale_date, last_sale_date,
         first_sale_ever_date, closed_on)
      select s.tenant_id, s.id, ${month}::date, m.receipts, m.first_sale, m.last_sale, e.first_ever,
             ${closedOn}
      ${billedStores}
      join lateral (
        select count(*)::int as receipts, min(r.business_date) as first_sale,
               max(r.business_date) as last_sale
        from pharmacy.receipts r
        where r.tenant_id = s.tenant_id and r.store_id = s.id
          and r.business_date >= ${month}::date
          and r.business_date < (${month}::date + interval '1 month')::date
      ) m on m.receipts > 0
      where ${billedWhere(tenantId)}`.execute(trx);
  }

  /**
   * The activity of `month` (YYYY-MM-01) by `through` (inclusive), read without writing: the stores
   * `refresh` would take with the receipts up to that day (the estimate of the owner, A19).
   */
  async activity(
    trx: TenantTransaction,
    tenantId: string,
    month: string,
    through: string,
  ): Promise<ActivityRow[]> {
    const { rows } = await sql<ActivityRow>`
      select s.id as store_id, s.name, e.first_ever::text as first_sale_ever,
             ${closedOn}::text as closed_on
      ${billedStores}
      where ${billedWhere(tenantId)}
        and exists (
          select 1 from pharmacy.receipts r
          where r.tenant_id = s.tenant_id and r.store_id = s.id
            and r.business_date >= ${month}::date and r.business_date <= ${through}::date)`.execute(
      trx,
    );
    return rows;
  }
}

/** A store active in a month: what an invoice or the estimate needs. */
export interface ActivityRow {
  storeId: string;
  name: string;
  firstSaleEver: string;
  closedOn: string | null;
}
