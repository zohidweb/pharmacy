import { Module } from '@nestjs/common';
import { SyncCoreModule } from '../../core/sync';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CheckpointFacts } from './checkpoint-facts';
import { FeedRetention } from './feed-retention';
import { InboxRepository } from './inbox.repository';
import { InboxRetention } from './inbox-retention';
import { SyncApplyService } from './sync-apply.service';
import { SyncFeedService } from './sync-feed.service';
import { SyncRunsRepository } from './sync-runs.repository';
import { SyncRunsService } from './sync-runs.service';

// The cloud side of the offline-store sync (ADR-0014; spec 2026-10-16-offline-sync): the store calls it with its
// license key. Registered in the cloud only; the store side of the protocol comes with PR 4. The facts are applied
// by the appliers the owning modules register in SyncAppliers (core/sync); the stock checkpoint reads the stock
// of the store through the export of inventory (StockFacts); the hourly purge clears the prescription data of old
// envelopes (InboxRetention). No routes here: they live in SyncReceiveModule, registered only with
// OFFLINE_SYNC_ENABLED (security review 2026-10-22, decision 7.4).
@Module({
  imports: [AuditModule, InventoryModule, SyncCoreModule],
  providers: [
    SyncRunsRepository,
    SyncRunsService,
    InboxRepository,
    SyncApplyService,
    SyncFeedService,
    CheckpointFacts,
    InboxRetention,
    FeedRetention,
  ],
  // InboxRetention — the purge of the prescription data in the envelopes (spec 2026-10-21-pos-offline-limits, P5;
  // `sync` → `platform/retention`); the services — to the routes of SyncReceiveModule
  exports: [
    InboxRetention,
    FeedRetention,
    SyncRunsService,
    SyncApplyService,
    SyncFeedService,
  ],
})
export class SyncModule {}
