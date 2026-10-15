import { Injectable } from '@nestjs/common';
import type { NotificationKind } from '@pharmacy/shared-dto';
import { type RawBuilder, sql, type SqlBool } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface NotificationContext {
  /** YYYY-MM-DD in the time zone of the network. */
  today: string;
  refreshedAt: Date | null;
  eventsAfter: Date | null;
  settingsUpdatedAt: Date | null;
  disabled: NotificationKind[];
  expiryDays: number;
  supplierDays: number;
}

export interface NewNotification {
  kind: NotificationKind;
  storeId: string | null;
  dedupeKey: string;
  entityType: string | null;
  entityId: string | null;
  params: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  storeId: string | null;
  params: Record<string, unknown>;
  createdAt: Date;
  read: boolean;
}

export interface VisibleFilter {
  employeeId: string;
  /** The kinds the employee receives; empty — nothing. */
  kinds: readonly NotificationKind[];
  eventKinds: readonly NotificationKind[];
  /** 'all' — every store and the notifications of the network. */
  scope: 'all' | readonly string[];
}

const CHUNK = 500;

// The notifications of the network, their read marks and the refresh state (spec
// 2026-10-14-owner-cabinet, E9–E12, 5.4).
@Injectable()
export class NotificationsRepository {
  async context(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<NotificationContext> {
    const result = await sql<NotificationContext>`
      select (now() at time zone coalesce(ts.timezone, 'Asia/Dushanbe'))::date::text as today,
             r.refreshed_at, r.events_after, ts.updated_at as settings_updated_at,
             coalesce(ts.disabled_notifications, '{}') as disabled,
             coalesce(ts.expiry_reminder_days, 30) as expiry_days,
             coalesce(ts.supplier_payment_reminder_days, 3) as supplier_days
      from (select 1) one
      left join pharmacy.tenant_settings ts on ts.tenant_id = ${tenantId}
      left join pharmacy.notification_refresh r on r.tenant_id = ${tenantId}`.execute(
      trx,
    );
    return result.rows[0];
  }

  /** One refresh of the network at a time; a second one skips (E11). */
  async tryLock(trx: TenantTransaction, tenantId: string): Promise<boolean> {
    const result = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(hashtextextended(${`notifications:${tenantId}`}, 0))
        as locked`.execute(trx);
    return result.rows[0].locked;
  }

  async storeNames(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<Map<string, string>> {
    const result = await sql<{ id: string; name: string }>`
      select id, name from pharmacy.stores where tenant_id = ${tenantId}`.execute(
      trx,
    );
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }

  /** New notifications; an open one with the same key takes the new parameters. */
  async upsert(
    trx: TenantTransaction,
    tenantId: string,
    items: readonly NewNotification[],
  ): Promise<void> {
    for (let start = 0; start < items.length; start += CHUNK) {
      const rows = items.slice(start, start + CHUNK).map(
        (item) =>
          sql`(${tenantId}::uuid, gen_random_uuid(), ${item.kind}, ${item.storeId}::uuid,
                 ${item.dedupeKey}, ${item.entityType}, ${item.entityId}::uuid,
                 ${JSON.stringify(item.params)}::jsonb)`,
      );
      await sql`
        insert into pharmacy.notifications
          (tenant_id, id, kind, store_id, dedupe_key, entity_type, entity_id, params)
        values ${sql.join(rows)}
        on conflict (tenant_id, dedupe_key) where resolved_at is null
        do update set params = excluded.params, store_id = excluded.store_id`.execute(
        trx,
      );
    }
  }

  /** Resolves the open notifications of a state kind whose state is gone. */
  async resolveMissing(
    trx: TenantTransaction,
    tenantId: string,
    kind: NotificationKind,
    keep: readonly string[],
  ): Promise<void> {
    await sql`
      update pharmacy.notifications set resolved_at = now()
      where tenant_id = ${tenantId} and kind = ${kind} and resolved_at is null
        and not (dedupe_key = any(${sql.val([...keep])}::text[]))`.execute(trx);
  }

  async markRefreshed(
    trx: TenantTransaction,
    tenantId: string,
    eventsAfter: Date,
  ): Promise<void> {
    await sql`
      insert into pharmacy.notification_refresh (tenant_id, refreshed_at, events_after)
      values (${tenantId}, now(), ${eventsAfter})
      on conflict (tenant_id) do update set
        refreshed_at = excluded.refreshed_at, events_after = excluded.events_after`.execute(
      trx,
    );
  }

  async list(
    trx: TenantTransaction,
    tenantId: string,
    filter: VisibleFilter,
    page: { limit: number; offset: number; unreadFirst: boolean },
  ): Promise<{ rows: NotificationRow[]; total: number; unread: number }> {
    if (filter.kinds.length === 0) return { rows: [], total: 0, unread: 0 };
    const where = this.visible(tenantId, filter);
    const read = sql<boolean>`exists (
      select 1 from pharmacy.notification_reads nr
      where nr.tenant_id = n.tenant_id and nr.notification_id = n.id
        and nr.employee_id = ${filter.employeeId})`;
    const counts = await sql<{ total: number; unread: number }>`
      select count(*)::integer as total, count(*) filter (where not ${read})::integer as unread
      from pharmacy.notifications n where ${where}`.execute(trx);
    const rows = await sql<NotificationRow>`
      select n.id, n.kind, n.store_id, n.params, n.created_at, ${read} as read
      from pharmacy.notifications n
      where ${where}
      order by ${page.unreadFirst ? sql`${read}, ` : sql``}n.created_at desc, n.id desc
      limit ${page.limit} offset ${page.offset}`.execute(trx);
    return {
      rows: rows.rows,
      total: counts.rows[0].total,
      unread: counts.rows[0].unread,
    };
  }

  async markAllRead(
    trx: TenantTransaction,
    tenantId: string,
    filter: VisibleFilter,
  ): Promise<void> {
    if (filter.kinds.length === 0) return;
    await sql`
      insert into pharmacy.notification_reads (tenant_id, notification_id, employee_id)
      select n.tenant_id, n.id, ${filter.employeeId}
      from pharmacy.notifications n
      where ${this.visible(tenantId, filter)}
      on conflict do nothing`.execute(trx);
  }

  // open states and the events of 30 days, of the kinds and the stores of the employee (E10, E12);
  // a notification of the whole network (no store, service_decided) reaches every scope
  private visible(
    tenantId: string,
    filter: VisibleFilter,
  ): RawBuilder<SqlBool> {
    const scope =
      filter.scope === 'all'
        ? sql`true`
        : sql`(n.store_id is null or n.store_id = any(${sql.val([...filter.scope])}::uuid[]))`;
    return sql<SqlBool>`n.tenant_id = ${tenantId}
      and n.kind = any(${sql.val([...filter.kinds])}::text[])
      and n.resolved_at is null
      and (not (n.kind = any(${sql.val([...filter.eventKinds])}::text[]))
           or n.created_at >= now() - interval '30 days')
      and ${scope}`;
  }
}
