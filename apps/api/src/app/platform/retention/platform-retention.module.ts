import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PosModule } from '../../pos/pos.module';
import { SyncModule } from '../../sync/sync.module';
import { ConnectionRequestsModule } from '../connection-requests/connection-requests.module';
import { PrescriptionPurgeScheduler } from './prescription-purge.scheduler';
import { RetentionRepository } from './retention.repository';

// The retention of the prescription data (spec 2026-10-21-pos-offline-limits, P3, P5; ADR-0013, amendment
// 2026-10-21) and of the change feed (spec 2026-10-16-offline-sync, section 13, 2026-10-23): the hourly pass over the
// networks reads them as the platform and purges through the exports of `pos` (`PrescriptionRetention`) and `sync`
// (`InboxRetention`, `FeedRetention`); the personal data of the declined connection requests of the site by their
// term — `ConnectionRequestRetention` of `platform/connection-requests` (ADR-0023). Cloud only: the POS of an offline
// store has no API yet.
@Module({
  imports: [
    PlatformDatabaseModule,
    PosModule,
    SyncModule,
    ConnectionRequestsModule,
  ],
  providers: [RetentionRepository, PrescriptionPurgeScheduler],
})
export class PlatformRetentionModule {}
