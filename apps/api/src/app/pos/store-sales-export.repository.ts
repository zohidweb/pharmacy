import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

// The statistics marts of the admin from the receipts of a network (spec
// 2026-10-19-admin-dashboard-stats, D1, D4, 5; tables store_sales_daily, tenant_cashiers_monthly,
// tenant_stats_refresh — tenant-export): only the store-days of the receipts written to the cloud since
// the last refresh are counted again. Receipts are append-only, so a row is rewritten, never deleted.
@Injectable()
export class StoreSalesExportRepository {
  /** One refresh of a network at a time (D6): false — another request is refreshing it now. */
  async tryLock(trx: TenantTransaction, tenantId: string): Promise<boolean> {
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(
        hashtextextended(${`platform-stats:${tenantId}`}, 0)) as locked`.execute(
      trx,
    );
    return rows[0].locked;
  }

  /**
   * Counts again the store-days of the receipts written since the last refresh less 10 minutes (a
   * transaction begun before it may commit after it; all receipts on the first refresh) by
   * `receipts_created_idx`, each store-day whole by `receipts_store_date_idx`. Returns the months of
   * those days (YYYY-MM-01), once each.
   */
  async refreshDays(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<string[]> {
    const { rows } = await sql<{ month: string }>`
      with touched as (
        select distinct r.store_id, r.business_date
        from pharmacy.receipts r
        where r.tenant_id = ${tenantId}
          and r.created_at >= coalesce(
            (select f.refreshed_at - interval '10 minutes'
             from pharmacy.tenant_stats_refresh f where f.tenant_id = ${tenantId}),
            '-infinity'::timestamptz)
      ), sums as (
        select r.store_id, r.business_date, count(*)::integer as receipts,
               sum(r.total_dirams) as sales, max(r.sold_at) as last_sold_at
        from touched t
        join pharmacy.receipts r
          on r.tenant_id = ${tenantId} and r.store_id = t.store_id
         and r.business_date = t.business_date
        group by r.store_id, r.business_date
      )
      insert into pharmacy.store_sales_daily
        (tenant_id, store_id, business_date, receipts_count, sales_dirams, last_sold_at, computed_at)
      select ${tenantId}, store_id, business_date, receipts, sales, last_sold_at, now() from sums
      on conflict (tenant_id, store_id, business_date) do update
        set receipts_count = excluded.receipts_count, sales_dirams = excluded.sales_dirams,
            last_sold_at = excluded.last_sold_at, computed_at = excluded.computed_at
      returning to_char(date_trunc('month', business_date), 'YYYY-MM-DD') as month`.execute(
      trx,
    );
    return [...new Set(rows.map((row) => row.month))];
  }

  /**
   * The different cashiers with a receipt of the network in each month given (D9), the receipts of
   * its stores by `receipts_store_date_idx`.
   */
  async refreshCashiers(
    trx: TenantTransaction,
    tenantId: string,
    months: readonly string[],
  ): Promise<void> {
    if (months.length === 0) return;
    await sql`
      insert into pharmacy.tenant_cashiers_monthly (tenant_id, month, active_cashiers, computed_at)
      select ${tenantId}, m.month,
             (select count(distinct r.cashier_id)::integer
              from pharmacy.receipts r
              where r.tenant_id = ${tenantId}
                and r.store_id in (select s.id from pharmacy.stores s where s.tenant_id = ${tenantId})
                and r.business_date >= m.month
                and r.business_date < (m.month + interval '1 month')::date),
             now()
      from unnest(${sql.val([...months])}::date[]) as m(month)
      on conflict (tenant_id, month) do update
        set active_cashiers = excluded.active_cashiers, computed_at = excluded.computed_at`.execute(
      trx,
    );
  }

  /** The time of this refresh — the start of its transaction, so receipts written meanwhile come next. */
  async markRefreshed(trx: TenantTransaction, tenantId: string): Promise<void> {
    await sql`
      insert into pharmacy.tenant_stats_refresh (tenant_id, refreshed_at)
      values (${tenantId}, now())
      on conflict (tenant_id) do update set refreshed_at = excluded.refreshed_at`.execute(
      trx,
    );
  }
}
