import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PosModule } from '../../pos/pos.module';
import { SyncModule } from '../../sync/sync.module';
import { PrescriptionPurgeScheduler } from './prescription-purge.scheduler';
import { RetentionRepository } from './retention.repository';

// The retention of the prescription data (spec 2026-10-21-pos-offline-limits, P3, P5; ADR-0013, amendment
// 2026-10-21): the hourly pass over the networks reads them as the platform and purges through the exports of
// `pos` (`PrescriptionRetention`) and `sync` (`InboxRetention`). Cloud only: the POS of an offline store has no API yet.
@Module({
  imports: [PlatformDatabaseModule, PosModule, SyncModule],
  providers: [RetentionRepository, PrescriptionPurgeScheduler],
})
export class PlatformRetentionModule {}
