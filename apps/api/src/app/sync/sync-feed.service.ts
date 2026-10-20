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

interface PageRow {
  entityType: SyncEntityType;
  entityId: string;
  scopeStoreId: string | null;
  seq: string;
}

// The change feed read by an offline store (ADR-0014 §3 with the amendment E5; spec 2026-10-16-offline-sync, E22):
// the reader numbers the changes committed so far under the advisory lock of the network — a change committed
// later gets a later number, so a cursor never skips it — removes the rows older than the window, and answers the
// entities changed after the cursor with their state now, as the source of their module reads it.
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
    return this.db.withTenant(store.tenantId, async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('sync-feed'), hashtext(${store.tenantId}))`.execute(
        trx,
      );
      await this.sequence(trx, store.tenantId);
      const horizon = await this.dropWindow(
        trx,
        store.tenantId,
        store.settings.feedWindowDays,
      );
      if (cursor < horizon) {
        throw new ProblemException(410, 'resync_required');
      }
      const rows = await this.page(trx, store, cursor, limit);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const changes = await this.states(trx, store, page);
      return {
        changes,
        cursor: page.length > 0 ? Number(page[page.length - 1].seq) : cursor,
        hasMore,
      };
    });
  }

  /** Numbers the changes committed so far, in the order of their ids. */
  private async sequence(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<void> {
    await sql`
      update pharmacy.sync_changes c set change_seq = s.seq
      from (select id, nextval('pharmacy.sync_change_seq') as seq
            from (select id from pharmacy.sync_changes
                  where tenant_id = ${tenantId} and change_seq is null
                  order by id) o) s
      where c.tenant_id = ${tenantId} and c.id = s.id`.execute(trx);
  }

  /** Removes the numbered changes older than the window and returns the horizon of the network. */
  private async dropWindow(
    trx: TenantTransaction,
    tenantId: string,
    windowDays: number,
  ): Promise<number> {
    const result = await sql<{ horizon: string }>`
      with dropped as (
        delete from pharmacy.sync_changes
        where tenant_id = ${tenantId} and change_seq is not null
          and changed_at < now() - make_interval(days => ${windowDays})
        returning change_seq
      )
      insert into pharmacy.sync_feed_state (tenant_id, horizon_seq)
      values (${tenantId}, coalesce((select max(change_seq) from dropped), 0))
      on conflict (tenant_id) do update set
        horizon_seq = greatest(pharmacy.sync_feed_state.horizon_seq, excluded.horizon_seq),
        updated_at = case when excluded.horizon_seq > pharmacy.sync_feed_state.horizon_seq
                          then now() else pharmacy.sync_feed_state.updated_at end
      returning horizon_seq as horizon`.execute(trx);
    return Number(result.rows[0]?.horizon ?? 0);
  }

  /** The entities changed after the cursor — of the network or of this store — in the order of their last change. */
  private async page(
    trx: TenantTransaction,
    store: SyncStore,
    cursor: number,
    limit: number,
  ): Promise<PageRow[]> {
    const result = await sql<PageRow>`
      select entity_type, entity_id, scope_store_id, max(change_seq)::text as seq
      from pharmacy.sync_changes
      where tenant_id = ${store.tenantId} and change_seq > ${cursor}
        and (scope_store_id is null or scope_store_id = ${store.storeId})
      group by entity_type, entity_id, scope_store_id
      order by max(change_seq)
      limit ${limit + 1}`.execute(trx);
    return result.rows;
  }

  /** The state of the entities of the page, read by the sources of their modules. */
  private async states(
    trx: TenantTransaction,
    store: SyncStore,
    page: readonly PageRow[],
  ): Promise<SyncChange[]> {
    const byType = new Map<SyncEntityType, string[]>();
    for (const row of page) {
      byType.set(row.entityType, [
        ...(byType.get(row.entityType) ?? []),
        row.entityId,
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
    return page.map((row) => {
      const state = data.get(row.entityType)?.get(row.entityId);
      return {
        seq: Number(row.seq),
        entityType: row.entityType,
        entityId: row.entityId,
        scopeStoreId: row.scopeStoreId,
        op: state ? 'upsert' : 'delete',
        data: (state as SyncChange['data']) ?? null,
      };
    });
  }
}
