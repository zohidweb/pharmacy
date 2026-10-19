import { Injectable } from '@nestjs/common';
import { type RawBuilder, type SqlBool, sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

type Money = bigint | string | number;

const iso = (value: Date | string): string => new Date(value).toISOString();

/** `column = any(ids)`, or every row when the ids are not given. */
const among = (
  column: RawBuilder<unknown>,
  ids: readonly string[] | null,
): RawBuilder<SqlBool> =>
  ids === null
    ? sql<SqlBool>`true`
    : sql<SqlBool>`${column} = any(${sql.val([...ids])}::uuid[])`;

// An open pharmacy of the registry (spec 2026-10-19-admin-dashboard-stats, D11): `s` is pharmacy.stores.
const OPEN_PHARMACY = sql<SqlBool>`s.kind = 'pharmacy' and s.status in ('active', 'closing')`;

export interface UsageStoreFigures {
  tenantId: string;
  storeId: string;
  storeName: string;
  online: boolean;
  receipts: number;
  salesMinor: number;
  lastActivityAt: string | null;
}

export interface ExpiringKey {
  id: string;
  tenantId: string;
  tenantName: string;
  storeName: string;
  validUntil: string;
  /** Days from today to the last day of the key (Dushanbe); negative — expired. */
  days: number;
}

export interface StaleStore {
  storeId: string;
  tenantId: string;
  tenantName: string;
  storeName: string;
  /** The last successful sync, or the issue of the key when the store never synced. */
  since: string;
  days: number;
}

// What the operator dashboard and the statistics read under pharmacy_platform (spec
// 2026-10-19-admin-dashboard-stats, 6; ADR-0013, §5 and amendment 2026-10-19): the registry of stores
// (the columns the platform sees, kind included), the statistics marts, the networks, the license keys
// and the sync status of offline stores — never the receipts.
@Injectable()
export class StatsRepository {
  async today(trx: Transaction<DB>): Promise<string> {
    const { rows } = await sql<{ today: string }>`
      select (now() at time zone 'Asia/Dushanbe')::date::text as today`.execute(
      trx,
    );
    return rows[0].today;
  }

  async tenantExists(trx: Transaction<DB>, id: string): Promise<boolean> {
    const { rows } = await sql`
      select 1 from pharmacy.tenants where id = ${id}`.execute(trx);
    return rows.length > 0;
  }

  /** The networks whose marts were never refreshed or are older than 5 minutes (D3). */
  async staleTenants(
    trx: Transaction<DB>,
    ids: readonly string[] | null,
  ): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      select t.id
      from pharmacy.tenants t
      left join pharmacy.tenant_stats_refresh f on f.tenant_id = t.id
      where ${among(sql`t.id`, ids)}
        and (f.refreshed_at is null or f.refreshed_at < now() - interval '5 minutes')
      order by t.id`.execute(trx);
    return rows.map((row) => row.id);
  }

  /** The oldest refresh of the networks given (D7); networks never refreshed do not count. */
  async asOf(
    trx: Transaction<DB>,
    ids: readonly string[] | null,
  ): Promise<string | null> {
    const { rows } = await sql<{ asOf: Date | string | null }>`
      select min(f.refreshed_at) as as_of
      from pharmacy.tenant_stats_refresh f
      where ${among(sql`f.tenant_id`, ids)}`.execute(trx);
    return rows[0].asOf === null ? null : iso(rows[0].asOf);
  }

  async counts(trx: Transaction<DB>): Promise<{
    tenants: number;
    activeTenants: number;
    cloudStores: number;
    offlineStores: number;
  }> {
    const { rows } = await sql<{
      tenants: Money;
      activeTenants: Money;
      cloudStores: Money;
      offlineStores: Money;
    }>`
      select (select count(*) from pharmacy.tenants) as tenants,
             (select count(*) from pharmacy.tenants where status = 'active') as active_tenants,
             (select count(*) from pharmacy.stores s
              where ${OPEN_PHARMACY} and s.mode = 'online') as cloud_stores,
             (select count(*) from pharmacy.stores s
              where ${OPEN_PHARMACY} and s.mode <> 'online') as offline_stores`.execute(
      trx,
    );
    const row = rows[0];
    return {
      tenants: Number(row.tenants),
      activeTenants: Number(row.activeTenants),
      cloudStores: Number(row.cloudStores),
      offlineStores: Number(row.offlineStores),
    };
  }

  /** The networks by name (the rows of the statistics, D11). */
  async tenants(
    trx: Transaction<DB>,
    tenantId: string | null,
  ): Promise<Array<{ id: string; name: string }>> {
    const { rows } = await sql<{ id: string; name: string }>`
      select t.id, t.name from pharmacy.tenants t
      where ${among(sql`t.id`, tenantId === null ? null : [tenantId])}
      order by t.name, t.id`.execute(trx);
    return rows;
  }

  /** The sum of the receipts by business date from `from` to `to`, every date, 0 without sales. */
  async salesByDay(
    trx: Transaction<DB>,
    from: string,
    to: string,
    tenantId: string | null,
  ): Promise<Array<{ date: string; salesMinor: number }>> {
    const { rows } = await sql<{ date: string; sales: Money }>`
      select d.day::date::text as date, coalesce(sum(x.sales_dirams), 0) as sales
      from generate_series(${from}::date, ${to}::date, interval '1 day') as d(day)
      left join pharmacy.store_sales_daily x
        on x.business_date = d.day::date
       and ${among(sql`x.tenant_id`, tenantId === null ? null : [tenantId])}
      group by d.day
      order by d.day`.execute(trx);
    return rows.map((row) => ({
      date: row.date,
      salesMinor: Number(row.sales),
    }));
  }

  /**
   * The pharmacies of the month (`YYYY-MM-01`): open ones and closed ones with receipts in it (D11),
   * with their receipts and sales of the month and their last activity (D10) — the last receipt ever
   * of a cloud store, the last successful sync of an offline one.
   */
  async usageStores(
    trx: Transaction<DB>,
    month: string,
    tenantId: string | null,
  ): Promise<UsageStoreFigures[]> {
    const { rows } = await sql<{
      tenantId: string;
      storeId: string;
      storeName: string;
      online: boolean;
      receipts: Money;
      sales: Money;
      lastActivityAt: Date | string | null;
    }>`
      select s.tenant_id, s.id as store_id, s.name as store_name, s.mode = 'online' as online,
             coalesce(m.receipts, 0) as receipts, coalesce(m.sales, 0) as sales,
             case when s.mode = 'online' then a.last_sold_at else ss.last_success_at end
               as last_activity_at
      from pharmacy.stores s
      left join lateral (
        select sum(x.receipts_count) as receipts, sum(x.sales_dirams) as sales
        from pharmacy.store_sales_daily x
        where x.tenant_id = s.tenant_id and x.store_id = s.id
          and x.business_date >= ${month}::date
          and x.business_date < (${month}::date + interval '1 month')::date
      ) m on true
      left join lateral (
        select max(x.last_sold_at) as last_sold_at
        from pharmacy.store_sales_daily x
        where x.tenant_id = s.tenant_id and x.store_id = s.id
      ) a on true
      left join pharmacy.store_sync_status ss
        on ss.tenant_id = s.tenant_id and ss.store_id = s.id
      where s.kind = 'pharmacy'
        and ${among(sql`s.tenant_id`, tenantId === null ? null : [tenantId])}
        and (s.status in ('active', 'closing') or m.receipts > 0)
      order by s.name, s.id`.execute(trx);
    return rows.map((row) => ({
      tenantId: row.tenantId,
      storeId: row.storeId,
      storeName: row.storeName,
      online: row.online,
      receipts: Number(row.receipts),
      salesMinor: Number(row.sales),
      lastActivityAt:
        row.lastActivityAt === null ? null : iso(row.lastActivityAt),
    }));
  }

  /** The different cashiers of the month (`YYYY-MM-01`) by network (D9). */
  async cashiers(
    trx: Transaction<DB>,
    month: string,
    tenantId: string | null,
  ): Promise<Map<string, number>> {
    const { rows } = await sql<{ tenantId: string; activeCashiers: number }>`
      select c.tenant_id, c.active_cashiers
      from pharmacy.tenant_cashiers_monthly c
      where c.month = ${month}::date
        and ${among(sql`c.tenant_id`, tenantId === null ? null : [tenantId])}`.execute(
      trx,
    );
    return new Map(rows.map((row) => [row.tenantId, row.activeCashiers]));
  }

  /**
   * The active keys of open offline pharmacies that end within their warning days or have ended
   * (D13), the soonest first.
   */
  async expiringKeys(
    trx: Transaction<DB>,
    today: string,
  ): Promise<ExpiringKey[]> {
    const { rows } = await sql<{
      id: string;
      tenantId: string;
      tenantName: string;
      storeName: string;
      validUntil: Date | string;
      days: number;
    }>`
      select k.id, k.tenant_id, t.name as tenant_name, s.name as store_name, k.valid_until,
             (k.valid_until at time zone 'Asia/Dushanbe')::date - ${today}::date as days
      from pharmacy.license_keys k
      join pharmacy.stores s on s.tenant_id = k.tenant_id and s.id = k.store_id
      join pharmacy.tenants t on t.id = k.tenant_id
      where k.status = 'active' and ${OPEN_PHARMACY} and s.mode <> 'online'
        and (k.valid_until at time zone 'Asia/Dushanbe')::date - ${today}::date
            <= k.notify_before_days
      order by k.valid_until, k.id`.execute(trx);
    return rows.map((row) => ({
      ...row,
      validUntil: iso(row.validUntil),
      days: Number(row.days),
    }));
  }

  /**
   * Open offline pharmacies without a successful sync for more than 7 days (D13, E30 of the offline
   * sync); one that never synced counts from the issue of its active key. The oldest first.
   */
  async staleStores(
    trx: Transaction<DB>,
    today: string,
  ): Promise<StaleStore[]> {
    const { rows } = await sql<{
      storeId: string;
      tenantId: string;
      tenantName: string;
      storeName: string;
      since: Date | string;
      days: number;
    }>`
      select s.id as store_id, s.tenant_id, t.name as tenant_name, s.name as store_name, x.since,
             ${today}::date - (x.since at time zone 'Asia/Dushanbe')::date as days
      from pharmacy.stores s
      join pharmacy.tenants t on t.id = s.tenant_id
      left join pharmacy.store_sync_status ss on ss.tenant_id = s.tenant_id and ss.store_id = s.id
      cross join lateral (
        select coalesce(
          ss.last_success_at,
          (select min(k.issued_at) from pharmacy.license_keys k
           where k.tenant_id = s.tenant_id and k.store_id = s.id and k.status = 'active')
        ) as since
      ) x
      where ${OPEN_PHARMACY} and s.mode <> 'online'
        and x.since < now() - interval '7 days'
      order by x.since, s.id`.execute(trx);
    return rows.map((row) => ({
      ...row,
      since: iso(row.since),
      days: Number(row.days),
    }));
  }
}
