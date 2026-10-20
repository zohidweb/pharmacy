import { Injectable, Logger } from '@nestjs/common';
import type {
  SyncChange,
  SyncChangesResponse,
  SyncEntityType,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import { ProblemException } from '../../common/errors/problem.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { SyncFeedSources } from '../../core/sync';
import type { SyncStore } from './sync-store.context';

/** The license statuses that receive the feed (spec E12); the others still send their operations. */
const FEED_STATUSES = new Set(['active', 'expiring']);
/** The version of every entity of the feed (spec E7: one version now, a downcast registry later). */
const ENTITY_VERSION = 1;
/** Rows numbered, and rows dropped with the window, per read: a backlog is worked off over reads (review I1). */
const SEQUENCE_CHUNK = 10_000;
/** Rows after the cursor a page is built from, per entry asked (review I2): a page never scans the whole feed. */
const SCAN_PER_ENTRY = 10;
const SCAN_MAX = 20_000;

interface FeedPosition {
  horizon: number;
  /** The highest number of the network after this read's numbering. */
  maxSeq: number;
  /** Unnumbered changes left for the next reads. */
  backlog: boolean;
}

interface ScanRow {
  seq: string;
  entityType: SyncEntityType;
  entityId: string;
  scopeStoreId: string | null;
}

interface Entry {
  seq: number;
  entityType: SyncEntityType;
  entityId: string;
  scopeStoreId: string | null;
}

// The change feed read by an offline store (ADR-0014 §3 with the amendment E5; spec 2026-10-16-offline-sync, E22).
// First, in a short transaction under the advisory lock of the network: the changes committed so far are numbered
// (a change committed later gets a later number, so a cursor never skips it) and the rows older than the window are
// dropped, raising the horizon — both in bounded chunks, so a long backlog is worked off over several reads. Then,
// without the lock, a page of the entities changed after the cursor is built from a bounded scan and answered with
// their state now, as the sources of their modules read it.
@Injectable()
export class SyncFeedService {
  private readonly logger = new Logger(SyncFeedService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly sources: SyncFeedSources,
  ) {}

  async changes(
    store: SyncStore,
    cursor: number | null,
    limit: number,
  ): Promise<SyncChangesResponse> {
    if (!FEED_STATUSES.has(store.license.status)) {
      throw new ProblemException(403, 'feed_closed');
    }
    // the first cursor comes with the snapshots (E23)
    if (cursor === null) throw new ProblemException(410, 'resync_required');
    // committed before the answer: a refusal below the horizon does not undo the work (review M2)
    const position = await this.db.withTenant(store.tenantId, (trx) =>
      this.advance(trx, store.tenantId, store.settings.feedWindowDays),
    );
    if (cursor < position.horizon) {
      throw new ProblemException(410, 'resync_required');
    }
    return this.db.withTenant(store.tenantId, (trx) =>
      this.page(trx, store, cursor, limit, position),
    );
  }

  /** Numbers the next chunk of committed changes and drops the window; returns the position of the feed. */
  private async advance(
    trx: TenantTransaction,
    tenantId: string,
    windowDays: number,
  ): Promise<FeedPosition> {
    await sql`select pg_advisory_xact_lock(hashtext('sync-feed'), hashtext(${tenantId}))`.execute(
      trx,
    );
    // Changes never numbered and already out of the window: no store read the network meanwhile. They are dropped
    // before numbering, and every cursor up to the highest number so far must resync — it would have seen them.
    const lost = await this.dropOlder(trx, tenantId, windowDays, false);
    let floor = 0;
    if (lost.count > 0) {
      const top = await sql<{ seq: string | null }>`
        select max(change_seq)::text as seq from pharmacy.sync_changes
        where tenant_id = ${tenantId} and change_seq is not null`.execute(trx);
      floor = Number(top.rows[0]?.seq ?? 0) + 1;
    }
    // The next chunk in the order of the ids, numbered in that order; the rows are updated by their keys (a join
    // with the subquery would scan the network's whole feed — review I1/I2).
    const pending = await sql<{ id: string; seq: string }>`
      select id, nextval('pharmacy.sync_change_seq')::text as seq
      from (select id from pharmacy.sync_changes
            where tenant_id = ${tenantId} and change_seq is null
            order by id
            limit ${SEQUENCE_CHUNK}) o
      order by id`.execute(trx);
    if (pending.rows.length > 0) {
      await sql`
        update pharmacy.sync_changes c set change_seq = v.seq
        from unnest(${sql.val(pending.rows.map((r) => r.id))}::uuid[],
                    ${sql.val(pending.rows.map((r) => r.seq))}::bigint[]) as v(id, seq)
        where c.tenant_id = ${tenantId} and c.id = v.id`.execute(trx);
    }
    const dropped = await this.dropOlder(trx, tenantId, windowDays, true);
    const result = await sql<{
      horizon: string;
      maxSeq: string | null;
      backlog: boolean;
    }>`
      with state as (
        insert into pharmacy.sync_feed_state (tenant_id, horizon_seq)
        values (${tenantId}, ${Math.max(floor, dropped.maxSeq)}::bigint)
        on conflict (tenant_id) do update set
          horizon_seq = greatest(pharmacy.sync_feed_state.horizon_seq, excluded.horizon_seq),
          updated_at = case when excluded.horizon_seq > pharmacy.sync_feed_state.horizon_seq
                            then now() else pharmacy.sync_feed_state.updated_at end
        returning horizon_seq
      )
      select (select horizon_seq from state)::text as horizon,
             (select max(change_seq) from pharmacy.sync_changes
              where tenant_id = ${tenantId} and change_seq is not null)::text as max_seq,
             exists (select 1 from pharmacy.sync_changes
                     where tenant_id = ${tenantId} and change_seq is null) as backlog`.execute(
      trx,
    );
    const row = result.rows[0];
    return {
      horizon: Number(row?.horizon ?? 0),
      maxSeq: Number(row?.maxSeq ?? 0),
      backlog: row?.backlog ?? false,
    };
  }

  /**
   * Drops a chunk of rows older than the window — numbered or not — found by the index on their time and deleted by
   * their keys (a delete driven by a subquery would scan the network's whole feed). Returns how many and the
   * highest number dropped.
   */
  private async dropOlder(
    trx: TenantTransaction,
    tenantId: string,
    windowDays: number,
    numbered: boolean,
  ): Promise<{ count: number; maxSeq: number }> {
    const rows = await sql<{ id: string; seq: string | null }>`
      select id, change_seq::text as seq from pharmacy.sync_changes
      where tenant_id = ${tenantId}
        and changed_at < now() - make_interval(days => ${windowDays})
        and change_seq is ${numbered ? sql`not null` : sql`null`}
      order by changed_at
      limit ${SEQUENCE_CHUNK}`.execute(trx);
    if (rows.rows.length === 0) return { count: 0, maxSeq: 0 };
    await sql`
      delete from pharmacy.sync_changes
      where tenant_id = ${tenantId}
        and id = any(${sql.val(rows.rows.map((r) => r.id))}::uuid[])`.execute(
      trx,
    );
    return {
      count: rows.rows.length,
      maxSeq: Math.max(0, ...rows.rows.map((r) => Number(r.seq ?? 0))),
    };
  }

  /**
   * A page: the first rows after the cursor — of the network or of this store — grouped by entity, each at its last
   * number in the scan, in that order. The cursor of the answer never passes a row of an entity not delivered.
   */
  private async page(
    trx: TenantTransaction,
    store: SyncStore,
    cursor: number,
    limit: number,
    position: FeedPosition,
  ): Promise<SyncChangesResponse> {
    const scanSize = Math.min(limit * SCAN_PER_ENTRY, SCAN_MAX);
    const scan = await sql<ScanRow>`
      select change_seq::text as seq, entity_type, entity_id, scope_store_id
      from pharmacy.sync_changes
      where tenant_id = ${store.tenantId} and change_seq > ${cursor}
        and (scope_store_id is null or scope_store_id = ${store.storeId})
      order by change_seq
      limit ${scanSize}`.execute(trx);
    const latest = new Map<string, Entry>();
    for (const row of scan.rows) {
      latest.set(`${row.entityType}|${row.entityId}|${row.scopeStoreId}`, {
        seq: Number(row.seq),
        entityType: row.entityType,
        entityId: row.entityId,
        scopeStoreId: row.scopeStoreId,
      });
    }
    const entries = [...latest.values()].sort((a, b) => a.seq - b.seq);
    const scanFull = scan.rows.length === scanSize;
    const lastScanned =
      scan.rows.length > 0 ? Number(scan.rows[scan.rows.length - 1].seq) : 0;
    let page: Entry[];
    let next: number;
    let hasMore: boolean;
    if (entries.length > limit) {
      page = entries.slice(0, limit);
      next = page[page.length - 1].seq;
      hasMore = true;
    } else if (scanFull) {
      // every entity of the scan is delivered: the cursor may pass the whole scan
      page = entries;
      next = lastScanned;
      hasMore = true;
    } else {
      // nothing of this store after the scan: the cursor passes the network's numbered rows too, so that rows of
      // other stores never hold it below a horizon (review M1)
      page = entries;
      next = Math.max(cursor, lastScanned, position.maxSeq);
      hasMore = position.backlog;
    }
    return {
      changes: await this.states(trx, store, page),
      cursor: next,
      hasMore,
    };
  }

  /** The state of the entities of the page, read by the sources of their modules. */
  private async states(
    trx: TenantTransaction,
    store: SyncStore,
    page: readonly Entry[],
  ): Promise<SyncChange[]> {
    const byType = new Map<SyncEntityType, string[]>();
    for (const entry of page) {
      byType.set(entry.entityType, [
        ...(byType.get(entry.entityType) ?? []),
        entry.entityId,
      ]);
    }
    const data = new Map<string, Map<string, unknown>>();
    for (const [type, ids] of byType) {
      const source = this.sources.sourceOf(type);
      if (!source) {
        // a writer records a type no module reads — a configuration error, not a silent gap in the feed
        this.logger.error(`No feed source for ${type}`);
        throw new Error(`No feed source for ${type}`);
      }
      data.set(
        type,
        await source.read(trx, store.tenantId, store.storeId, type, [
          ...new Set(ids),
        ]),
      );
    }
    return page.map((entry) => {
      const state = data.get(entry.entityType)?.get(entry.entityId);
      return {
        seq: entry.seq,
        entityType: entry.entityType,
        typeVersion: ENTITY_VERSION,
        entityId: entry.entityId,
        scopeStoreId: entry.scopeStoreId,
        op: state ? 'upsert' : 'delete',
        data: (state as SyncChange['data']) ?? null,
      };
    });
  }
}
