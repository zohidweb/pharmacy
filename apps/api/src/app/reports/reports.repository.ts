import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

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
      select (now() at time zone coalesce(ts.timezone, 'Asia/Dushanbe'))::date::text as today,
             coalesce(ts.expiry_reminder_days, 30) as expiry_days
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
}
