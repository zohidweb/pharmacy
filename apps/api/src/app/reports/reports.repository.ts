import { Injectable } from '@nestjs/common';
import { networkSettingsDefaults as defaults } from '@pharmacy/shared-domain';
import { sql } from 'kysely';
import {
  settingsTimeZone,
  type TenantTransaction,
  tenantTimeZone,
} from '../../core/database';

export interface ReportStore {
  id: string;
  name: string;
  /** `pharmacy` | `warehouse`. */
  kind: string;
  /** Database mode `online` | `offline_pending` | `offline`. */
  mode: string;
}

// The network facts the home needs besides the exports of the domain modules: today, the expiry
// threshold and the active stores (reference data of the network).
@Injectable()
export class ReportsRepository {
  async context(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<{ today: string; expiryDays: number }> {
    const result = await sql<{ today: string; expiryDays: number }>`
      select (now() at time zone ${settingsTimeZone()})::date::text as today,
             coalesce(ts.expiry_reminder_days, ${defaults.expiryReminderDays}) as expiry_days
      from (select 1) one
      left join pharmacy.tenant_settings ts on ts.tenant_id = ${tenantId}`.execute(
      trx,
    );
    return result.rows[0];
  }

  /** Active stores of the network; `scope` 'all' — every one, otherwise only these ids. */
  async activeStores(
    trx: TenantTransaction,
    tenantId: string,
    scope: 'all' | readonly string[],
  ): Promise<ReportStore[]> {
    if (scope !== 'all' && scope.length === 0) return [];
    const result = await sql<ReportStore>`
      select id, name, kind, mode from pharmacy.stores
      where tenant_id = ${tenantId} and status = 'active'
        ${scope === 'all' ? sql`` : sql`and id = any(${sql.val([...scope])}::uuid[])`}
      order by name, id`.execute(trx);
    return result.rows;
  }

  /**
   * The stores of a report from `from` (spec 2026-10-15-store-closing, E13): the active and closing
   * stores of the scope, and the closed ones closed on `from` or later — a closed store keeps its
   * history for the periods it worked, its row leaves the periods after it.
   */
  async reportStores(
    trx: TenantTransaction,
    tenantId: string,
    scope: 'all' | readonly string[],
    from: string,
  ): Promise<ReportStore[]> {
    if (scope !== 'all' && scope.length === 0) return [];
    const result = await sql<ReportStore>`
      select s.id, s.name, s.kind, s.mode from pharmacy.stores s
      where s.tenant_id = ${tenantId}
        and (s.status in ('active', 'closing')
             or (s.status = 'closed'
                 and (s.closed_at at time zone ${tenantTimeZone(sql.ref('s.tenant_id'))})::date
                     >= ${from}::date))
        ${scope === 'all' ? sql`` : sql`and s.id = any(${sql.val([...scope])}::uuid[])`}
      order by s.name, s.id`.execute(trx);
    return result.rows;
  }

  /** Language maps of the names of the products. */
  async productNames(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, unknown>> {
    if (ids.length === 0) return new Map();
    const result = await sql<{ id: string; name: unknown }>`
      select id, name from pharmacy.products
      where tenant_id = ${tenantId} and id = any(${sql.val([...ids])}::uuid[])`.execute(
      trx,
    );
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }

  /** Language maps of the names of every category of the network. */
  async categoryNames(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<Map<string, unknown>> {
    const result = await sql<{ id: string; name: unknown }>`
      select id, name from pharmacy.categories where tenant_id = ${tenantId}`.execute(
      trx,
    );
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }

  async employeeNames(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const result = await sql<{ id: string; fullName: string }>`
      select id, full_name from pharmacy.employees
      where tenant_id = ${tenantId} and id = any(${sql.val([...ids])}::uuid[])`.execute(
      trx,
    );
    return new Map(result.rows.map((row) => [row.id, row.fullName]));
  }
}
