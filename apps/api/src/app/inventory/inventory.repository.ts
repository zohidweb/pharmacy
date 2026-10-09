import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** A store as the stock documents need it. */
export interface StoreForWrite {
  id: string;
  code: string;
  name: string;
  mode: string;
  status: string;
  legalEntityId: string;
  /** Closed period of the legal entity of the store, YYYY-MM-DD. */
  closedUntil: string | null;
}

export interface StockSettings {
  /** Business date of the network, YYYY-MM-DD. */
  today: string;
  backdatingMaxDays: number;
  expiryReminderDays: number;
}

// Organisation data the stock module reads (stores, legal entities, settings) and the stock of
// batches — the sum of their movements (data model 03: stock is never stored).
@Injectable()
export class InventoryRepository {
  async store(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<StoreForWrite | null> {
    const result = await sql<StoreForWrite>`
      select s.id, s.code, s.name, s.mode, s.status, s.legal_entity_id,
             le.closed_until::text as closed_until
      from pharmacy.stores s
      join pharmacy.legal_entities le on le.tenant_id = s.tenant_id and le.id = s.legal_entity_id
      where s.tenant_id = ${tenantId} and s.id = ${storeId}`.execute(trx);
    return result.rows[0] ?? null;
  }

  async storeNames(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await trx
      .selectFrom('stores')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute();
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Active stores of the network; `scope` null — every one. */
  async activeStores(
    trx: TenantTransaction,
    tenantId: string,
    scope: readonly string[] | null,
  ): Promise<Array<{ id: string; name: string; mode: string }>> {
    if (scope !== null && scope.length === 0) return [];
    let query = trx
      .selectFrom('stores')
      .select(['id', 'name', 'mode'])
      .where('tenantId', '=', tenantId)
      .where('status', '=', 'active');
    if (scope !== null) query = query.where('id', 'in', [...scope]);
    return query.orderBy('name').orderBy('id').execute();
  }

  async settings(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<StockSettings> {
    const result = await sql<StockSettings>`
      select (now() at time zone coalesce(ts.timezone, 'Asia/Dushanbe'))::date::text as today,
             coalesce(ts.backdating_max_days, 30) as backdating_max_days,
             coalesce(ts.expiry_reminder_days, 30) as expiry_reminder_days
      from (select 1) one
      left join pharmacy.tenant_settings ts on ts.tenant_id = ${tenantId}`.execute(
      trx,
    );
    return result.rows[0];
  }

  async employeeNames(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await trx
      .selectFrom('employees')
      .select(['id', 'fullName'])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', unique)
      .execute();
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}
