import { Global, Module } from '@nestjs/common';
import { ImportJobs } from './import-jobs';

// The journal of the loads from a file (spec 2026-10-20-data-import, F18): the catalog, inventory and purchasing
// modules load their own data and share it. Global, as the database and the sync seams.
@Global()
@Module({
  providers: [ImportJobs],
  exports: [ImportJobs],
})
export class ImportsCoreModule {}
