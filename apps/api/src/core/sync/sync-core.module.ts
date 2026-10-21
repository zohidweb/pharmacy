import { Global, Module } from '@nestjs/common';
import { SyncAppliers } from './fact-applier';
import { SyncChanges, SyncFeedSources } from './feed';

// The sync seams every domain module may use (spec 2026-10-16-offline-sync, E2–E4): the registry of the
// appliers of store facts, the change feed (its port and the registry of its sources); the outbox journal joins
// them with PR 4. Global, as the
// database: a domain module needs no import to register its applier.
@Global()
@Module({
  providers: [SyncAppliers, SyncChanges, SyncFeedSources],
  exports: [SyncAppliers, SyncChanges, SyncFeedSources],
})
export class SyncCoreModule {}
