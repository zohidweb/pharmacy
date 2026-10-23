import { Injectable } from '@nestjs/common';
import { TenantDatabase } from '../../core/database';
import { readSyncSettings } from './license-key.guard';
import { SyncFeedService } from './sync-feed.service';

/** Window steps of one network per pass: each one numbers and drops at most a chunk, in its own transaction. */
const MAX_STEPS = 10;

// The change feed kept within its window without a reader (spec 2026-10-16-offline-sync, section 13, 2026-10-23):
// `sync_changes` is written on every change of the catalog and the prices, and a read of the feed by an offline
// store drops the rows older than `feed_window_days`. A network no store reads — every network while
// OFFLINE_SYNC_ENABLED is off — would keep them forever, so the hourly pass of `platform/retention` runs the same step
// of the feed, under the same advisory lock of the network: the horizon rises as for a read, and a store that comes
// later starts from the snapshots anyway.
@Injectable()
export class FeedRetention {
  constructor(
    private readonly db: TenantDatabase,
    private readonly feed: SyncFeedService,
  ) {}

  /** Numbers the committed changes and drops the rows past the window; returns how many rows were dropped. */
  async keepWindow(tenantId: string): Promise<number> {
    let dropped = 0;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const position = await this.db.withTenant(tenantId, async (trx) => {
        const settings = await readSyncSettings(trx);
        return this.feed.advance(trx, tenantId, settings.feedWindowDays);
      });
      dropped += position.dropped;
      // a full chunk may leave more rows past the window; the rest waits for the next pass after MAX_STEPS
      if (!position.backlog && position.dropped === 0) break;
    }
    return dropped;
  }
}
