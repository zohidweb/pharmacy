import { Injectable } from '@nestjs/common';
import type { SyncEntityData, SyncEntityType } from '@pharmacy/shared-dto';
import { newId, type TenantTransaction } from '../database';

// The change feed, cloud → offline store (ADR-0014 §3; spec 2026-10-16-offline-sync, E4, E5, E22): a writer of an
// entity the stores need records «entity X changed» in its own transaction; the feed reader numbers the changes and
// asks the source of the entity's module for its current state. Domain modules own both sides: they record and
// they read their rows — the sync contour never reads their tables.

/** A change to record: the entity, and the store it belongs to when it is not of the whole network. */
export interface FeedChange {
  tenantId: string;
  entityType: SyncEntityType;
  entityId: string;
  scopeStoreId?: string | null;
}

/**
 * Records a change of an entity in the writer's transaction (E4). Always written — a row is cheap, and a store
 * that becomes offline later starts from a snapshot anyway. Its number in the feed is given at read time (E5).
 */
@Injectable()
export class SyncChanges {
  async record(trx: TenantTransaction, change: FeedChange): Promise<void> {
    await trx
      .insertInto('syncChanges')
      .values({
        tenantId: change.tenantId,
        id: newId(),
        scopeStoreId: change.scopeStoreId ?? null,
        entityType: change.entityType,
        entityId: change.entityId,
      })
      .execute();
  }

  /** Records several entities of one type at once (e.g. the products of a category whose markup changed). */
  async recordMany(
    trx: TenantTransaction,
    changes: readonly FeedChange[],
  ): Promise<void> {
    if (changes.length === 0) return;
    // ≤ 1 000 rows per statement: PostgreSQL takes at most 65 535 bind parameters
    for (let from = 0; from < changes.length; from += 1_000) {
      await trx
        .insertInto('syncChanges')
        .values(
          changes.slice(from, from + 1_000).map((change) => ({
            tenantId: change.tenantId,
            id: newId(),
            scopeStoreId: change.scopeStoreId ?? null,
            entityType: change.entityType,
            entityId: change.entityId,
          })),
        )
        .execute();
    }
  }
}

/**
 * The current state of entities of the types a module owns, read in the feed reader's transaction. A missing key
 * in the answer is an entity that is gone (a tombstone). `storeId` is the store reading the feed: the scope of a
 * store entity (e.g. its price) is already filtered to it.
 */
export interface FeedSource {
  readonly entityTypes: readonly SyncEntityType[];
  read(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    entityType: SyncEntityType,
    ids: readonly string[],
  ): Promise<Map<string, SyncEntityData>>;
}

/** The registry of the feed sources, filled by the modules that own the entities (as SyncAppliers). */
@Injectable()
export class SyncFeedSources {
  private readonly byType = new Map<SyncEntityType, FeedSource>();

  register(source: FeedSource): void {
    for (const type of source.entityTypes) {
      if (this.byType.has(type)) {
        throw new Error(`A feed source for ${type} is already registered`);
      }
      this.byType.set(type, source);
    }
  }

  sourceOf(type: SyncEntityType): FeedSource | undefined {
    return this.byType.get(type);
  }
}

/**
 * A row of a table as the feed sends it: bigint as a number (money in dirams fits a safe integer — a value beyond
 * it is a broken row, an error), a timestamp as ISO 8601; everything else as is.
 */
export function feedRow(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      if (
        value > BigInt(Number.MAX_SAFE_INTEGER) ||
        value < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        throw new Error(`A feed value of ${key} is beyond a safe integer`);
      }
      out[key] = Number(value);
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else {
      out[key] = value;
    }
  }
  return out;
}
