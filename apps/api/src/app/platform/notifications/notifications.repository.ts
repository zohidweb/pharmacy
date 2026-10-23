import { Injectable } from '@nestjs/common';
import type {
  EventKind,
  EventParams,
  NotificationTopic,
} from '@pharmacy/shared-dto';
import { type RawBuilder, type SqlBool, sql, type Transaction } from 'kysely';
import { type DB, newId, platformToday } from '../../../core/database';
import { EVENT_KINDS, STATE_KINDS } from './notification-topics';

type Money = bigint | string | number;

const CHUNK = 200;

export interface NewPlatformNotification {
  kind: EventKind;
  dedupeKey: string;
  tenantId: string | null;
  storeId: string | null;
  entityType: string;
  entityId: string;
  params: EventParams;
  /** The time of an event; a state appears now. */
  createdAt?: Date;
  /** The operator who made the event: it is read for them at once (N4). */
  authorId?: string | null;
}

export interface PlatformNotificationRow {
  id: string;
  kind: EventKind;
  tenantId: string | null;
  params: EventParams;
  createdAt: Date;
  read: boolean;
}

/** Open states and the events of 30 days (N7); `n` is pharmacy.platform_notifications. */
const VISIBLE = sql<SqlBool>`(
  (n.kind = any(${sql.val([...STATE_KINDS])}::text[]) and n.resolved_at is null)
  or (n.kind = any(${sql.val([...EVENT_KINDS])}::text[])
      and n.created_at > now() - interval '30 days'))`;

const ofKinds = (kinds: readonly EventKind[]): RawBuilder<SqlBool> =>
  sql<SqlBool>`n.kind = any(${sql.val([...kinds])}::text[])`;

// The notifications of the operators (spec 2026-10-19-operator-notifications, N1–N9; tables
// platform_notifications, platform_notification_reads, platform_notification_refresh — platform), in the
// platform transaction of the caller under pharmacy_platform.
@Injectable()
export class PlatformNotificationsRepository {
  async today(trx: Transaction<DB>): Promise<string> {
    const { rows } = await sql<{ today: string }>`
      select ${platformToday()}::text as today`.execute(trx);
    return rows[0].today;
  }

  async lastRefresh(
    trx: Transaction<DB>,
  ): Promise<{ refreshedAt: Date; eventsAfter: Date } | null> {
    const { rows } = await sql<{ refreshedAt: Date; eventsAfter: Date }>`
      select refreshed_at, events_after from pharmacy.platform_notification_refresh
      where id = 1`.execute(trx);
    return rows[0] ?? null;
  }

  /** One refresh at a time (N2): false — another request is refreshing now. */
  async tryLock(trx: Transaction<DB>): Promise<boolean> {
    const { rows } = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(hashtextextended('platform-notifications', 0)) as locked`.execute(
      trx,
    );
    return rows[0].locked;
  }

  /** A state: new, or the open one with the same key takes the new parameters. */
  async upsertStates(
    trx: Transaction<DB>,
    items: readonly NewPlatformNotification[],
  ): Promise<void> {
    for (let start = 0; start < items.length; start += CHUNK) {
      const rows = items.slice(start, start + CHUNK).map(
        (item) =>
          sql`(${newId()}::uuid, ${item.kind}, ${item.dedupeKey}, ${item.tenantId}::uuid,
                 ${item.storeId}::uuid, ${item.entityType}, ${item.entityId}::uuid,
                 ${JSON.stringify(item.params)}::jsonb)`,
      );
      await sql`
        insert into pharmacy.platform_notifications
          (id, kind, dedupe_key, tenant_id, store_id, entity_type, entity_id, params)
        values ${sql.join(rows)}
        on conflict (dedupe_key) where resolved_at is null
        do update set params = excluded.params`.execute(trx);
    }
  }

  /** Resolves the open notifications of a state kind whose state is gone. */
  async resolveMissing(
    trx: Transaction<DB>,
    kind: EventKind,
    keep: readonly string[],
  ): Promise<void> {
    await sql`
      update pharmacy.platform_notifications set resolved_at = now()
      where kind = ${kind} and resolved_at is null
        and not (dedupe_key = any(${sql.val([...keep])}::text[]))`.execute(trx);
  }

  /** Events at their own time; a repeat of a key adds nothing; the author has it read (N4). */
  async insertEvents(
    trx: Transaction<DB>,
    items: readonly NewPlatformNotification[],
  ): Promise<void> {
    for (const item of items) {
      const { rows } = await sql<{ id: string }>`
        insert into pharmacy.platform_notifications
          (id, kind, dedupe_key, tenant_id, store_id, entity_type, entity_id, params, created_at)
        values (${newId()}::uuid, ${item.kind}, ${item.dedupeKey}, ${item.tenantId}::uuid,
                ${item.storeId}::uuid, ${item.entityType}, ${item.entityId}::uuid,
                ${JSON.stringify(item.params)}::jsonb, ${item.createdAt ?? new Date()})
        on conflict (dedupe_key) where resolved_at is null do nothing
        returning id`.execute(trx);
      if (rows[0] && item.authorId) {
        await sql`
          insert into pharmacy.platform_notification_reads (notification_id, operator_id)
          values (${rows[0].id}, ${item.authorId})
          on conflict do nothing`.execute(trx);
      }
    }
  }

  async markRefreshed(trx: Transaction<DB>): Promise<void> {
    await sql`
      insert into pharmacy.platform_notification_refresh (id, refreshed_at, events_after)
      values (1, now(), now())
      on conflict (id) do update set
        refreshed_at = excluded.refreshed_at, events_after = excluded.events_after`.execute(
      trx,
    );
  }

  /** Payments recorded after the mark and not cancelled (`payment_recorded`). */
  async payments(
    trx: Transaction<DB>,
    after: Date,
  ): Promise<
    Array<{
      id: string;
      tenantId: string;
      tenantName: string;
      amount: Money;
      recordedBy: string | null;
      createdAt: Date;
    }>
  > {
    const { rows } = await sql<{
      id: string;
      tenantId: string;
      tenantName: string;
      amount: Money;
      recordedBy: string | null;
      createdAt: Date;
    }>`
      select p.id, p.tenant_id, t.name as tenant_name, p.amount_dirams as amount, p.recorded_by,
             p.created_at
      from pharmacy.tenant_payments p
      join pharmacy.tenants t on t.id = p.tenant_id
      where p.created_at > ${after} and p.cancelled_at is null
      order by p.created_at, p.id`.execute(trx);
    return rows;
  }

  /**
   * Keys revoked after the mark (`key_revoked`), soft or hard; a key replaced by a new one (a reissue,
   * `replaces_key_id`) is no alarm (final review M4).
   */
  async revokedKeys(
    trx: Transaction<DB>,
    after: Date,
  ): Promise<
    Array<{
      id: string;
      tenantId: string;
      tenantName: string;
      storeId: string;
      storeName: string;
      revokedBy: string | null;
      revokedAt: Date;
    }>
  > {
    const { rows } = await sql<{
      id: string;
      tenantId: string;
      tenantName: string;
      storeId: string;
      storeName: string;
      revokedBy: string | null;
      revokedAt: Date;
    }>`
      select k.id, k.tenant_id, t.name as tenant_name, k.store_id, s.name as store_name,
             k.revoked_by, k.revoked_at
      from pharmacy.license_keys k
      join pharmacy.tenants t on t.id = k.tenant_id
      join pharmacy.stores s on s.tenant_id = k.tenant_id and s.id = k.store_id
      where k.revoked_at > ${after}
        and not exists (
          select 1 from pharmacy.license_keys n where n.replaces_key_id = k.id)
      order by k.revoked_at, k.id`.execute(trx);
    return rows;
  }

  /** The visible notifications by kind (the counters of the topics, N7). */
  async countsByKind(trx: Transaction<DB>): Promise<Map<EventKind, number>> {
    const { rows } = await sql<{ kind: EventKind; n: number }>`
      select n.kind, count(*)::integer as n
      from pharmacy.platform_notifications n
      where ${VISIBLE}
      group by n.kind`.execute(trx);
    return new Map(rows.map((row) => [row.kind, row.n]));
  }

  /** A page of the visible notifications of the kinds given, newest first, read by the operator or not. */
  async list(
    trx: Transaction<DB>,
    operatorId: string,
    kinds: readonly EventKind[],
    page: { limit: number; offset: number },
  ): Promise<{
    rows: PlatformNotificationRow[];
    total: number;
    unread: number;
  }> {
    if (kinds.length === 0) return { rows: [], total: 0, unread: 0 };
    const read = sql<boolean>`exists (
      select 1 from pharmacy.platform_notification_reads r
      where r.notification_id = n.id and r.operator_id = ${operatorId})`;
    const counts = await sql<{ total: number; unread: number }>`
      select count(*)::integer as total, count(*) filter (where not ${read})::integer as unread
      from pharmacy.platform_notifications n
      where ${VISIBLE} and ${ofKinds(kinds)}`.execute(trx);
    const { rows } = await sql<PlatformNotificationRow>`
      select n.id, n.kind, n.tenant_id, n.params, n.created_at, ${read} as read
      from pharmacy.platform_notifications n
      where ${VISIBLE} and ${ofKinds(kinds)}
      order by n.created_at desc, n.id desc
      limit ${page.limit} offset ${page.offset}`.execute(trx);
    return { rows, total: counts.rows[0].total, unread: counts.rows[0].unread };
  }

  /**
   * The visible notifications up to `upTo` are read by the operator (N8): ids are UUIDv7, so `n.id <=
   * upTo` is what was inserted before the newest one the operator saw; null — every visible one.
   */
  async markAllRead(
    trx: Transaction<DB>,
    operatorId: string,
    upTo: string | null,
  ): Promise<void> {
    await sql`
      insert into pharmacy.platform_notification_reads (notification_id, operator_id)
      select n.id, ${operatorId} from pharmacy.platform_notifications n
      where ${VISIBLE} and (${upTo}::uuid is null or n.id <= ${upTo}::uuid)
      on conflict do nothing`.execute(trx);
  }

  async muted(
    trx: Transaction<DB>,
    operatorId: string,
  ): Promise<NotificationTopic[]> {
    const { rows } = await sql<{ muted: NotificationTopic[] }>`
      select muted_notification_topics as muted from pharmacy.operators
      where id = ${operatorId}`.execute(trx);
    return rows[0]?.muted ?? [];
  }

  async setMuted(
    trx: Transaction<DB>,
    operatorId: string,
    topics: readonly NotificationTopic[],
  ): Promise<void> {
    await sql`
      update pharmacy.operators set muted_notification_topics = ${sql.val([...topics])}::text[]
      where id = ${operatorId}`.execute(trx);
  }
}
