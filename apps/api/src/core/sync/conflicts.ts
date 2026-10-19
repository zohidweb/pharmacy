import { sql } from 'kysely';
import { newId, type TenantTransaction } from '../database';
import { SyncApplyError } from './fact-applier';

// The conflicts of offline stores (spec 2026-10-16-offline-sync, E25, E26; data model 06): at most one open
// conflict per store, kind and entity (`sync_conflicts_open_uq`). Written by the appliers of the domains that own
// the entity (pricing, catalog), read by the owner's cabinet and the store's feed in later PRs.

export type SyncConflictKind = 'price' | 'duplicate_product';

export interface OpenConflict {
  tenantId: string;
  storeId: string;
  kind: SyncConflictKind;
  entityId: string;
  localValue: Record<string, unknown>;
  cloudValue: Record<string, unknown>;
}

/**
 * Opens a conflict. An open conflict of the same store, kind and entity is refreshed with the new values when
 * `onOpen` is `refresh` (a later local change of the same price) and left as it is when `keep`.
 */
export async function openConflict(
  trx: TenantTransaction,
  conflict: OpenConflict,
  onOpen: 'refresh' | 'keep',
): Promise<void> {
  const local = JSON.stringify(conflict.localValue);
  const cloud = JSON.stringify(conflict.cloudValue);
  const onConflict =
    onOpen === 'refresh'
      ? sql`do update set local_value = excluded.local_value, cloud_value = excluded.cloud_value`
      : sql`do nothing`;
  await sql`
    insert into pharmacy.sync_conflicts
      (tenant_id, id, kind, store_id, entity_id, local_value, cloud_value)
    values (${conflict.tenantId}, ${newId()}, ${conflict.kind}, ${conflict.storeId},
            ${conflict.entityId}, ${local}::jsonb, ${cloud}::jsonb)
    on conflict (tenant_id, store_id, kind, entity_id) where status = 'open'
    ${onConflict}`.execute(trx);
}

export interface LockedConflict {
  kind: string;
  storeId: string;
  entityId: string;
  status: string;
  cloudValue: unknown;
}

/** A conflict of the network by id, locked; null — none. */
export async function lockConflict(
  trx: TenantTransaction,
  tenantId: string,
  id: string,
): Promise<LockedConflict | null> {
  const row = await trx
    .selectFrom('syncConflicts')
    .select(['kind', 'storeId', 'entityId', 'status', 'cloudValue'])
    .where('tenantId', '=', tenantId)
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  return row ?? null;
}

/** Closes a conflict by id. */
export async function resolveConflict(
  trx: TenantTransaction,
  c: {
    tenantId: string;
    id: string;
    resolution: 'cloud' | 'local' | 'merge' | 'keep';
    resolvedBy: string;
    resolvedAt: Date;
  },
): Promise<void> {
  await trx
    .updateTable('syncConflicts')
    .set({
      status: 'resolved',
      resolution: c.resolution,
      resolvedBy: c.resolvedBy,
      resolvedAt: c.resolvedAt,
    })
    .where('tenantId', '=', c.tenantId)
    .where('id', '=', c.id)
    .execute();
}

/** Closes the open conflict of the store, kind and entity, if there is one. */
export async function resolveOpenConflict(
  trx: TenantTransaction,
  c: {
    tenantId: string;
    storeId: string;
    kind: SyncConflictKind;
    entityId: string;
    resolution: 'cloud' | 'local' | 'merge' | 'keep';
    resolvedBy: string;
    resolvedAt: Date;
  },
): Promise<void> {
  await trx
    .updateTable('syncConflicts')
    .set({
      status: 'resolved',
      resolution: c.resolution,
      resolvedBy: c.resolvedBy,
      resolvedAt: c.resolvedAt,
    })
    .where('tenantId', '=', c.tenantId)
    .where('storeId', '=', c.storeId)
    .where('kind', '=', c.kind)
    .where('entityId', '=', c.entityId)
    .where('status', '=', 'open')
    .execute();
}

/** A timestamp of the store's clock; an unreadable one is a quarantine. */
export function storeTime(value: unknown, code = 'invalid_time'): Date {
  const time = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(time.getTime())) throw new SyncApplyError(code);
  return time;
}
