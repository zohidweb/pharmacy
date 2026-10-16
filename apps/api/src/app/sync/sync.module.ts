import { Module } from '@nestjs/common';
import { LicenseKeyGuard } from './license-key.guard';
import { SyncReceiveController } from './sync-receive.controller';
import { SyncRunsRepository } from './sync-runs.repository';
import { SyncRunsService } from './sync-runs.service';

// The cloud side of the offline-store sync (ADR-0014; spec 2026-10-16-offline-sync): the store calls it with its
// license key. Registered in the cloud only; the store side of the protocol comes with PR 4.
@Module({
  controllers: [SyncReceiveController],
  providers: [LicenseKeyGuard, SyncRunsRepository, SyncRunsService],
})
export class SyncModule {}
