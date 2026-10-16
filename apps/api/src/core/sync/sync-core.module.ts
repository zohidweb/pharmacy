import { Global, Module } from '@nestjs/common';
import { SyncAppliers } from './fact-applier';

// The sync seams every domain module may use (spec 2026-10-16-offline-sync, E2–E4): the registry of the
// appliers of store facts now; the outbox journal (PR 4) and the change feed (PR 3) join it. Global, as the
// database: a domain module needs no import to register its applier.
@Global()
@Module({
  providers: [SyncAppliers],
  exports: [SyncAppliers],
})
export class SyncCoreModule {}
