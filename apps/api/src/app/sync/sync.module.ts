import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InboxRepository } from './inbox.repository';
import { LicenseKeyGuard } from './license-key.guard';
import { SyncApplyService } from './sync-apply.service';
import { SyncReceiveController } from './sync-receive.controller';
import { SyncRunsRepository } from './sync-runs.repository';
import { SyncRunsService } from './sync-runs.service';

// The cloud side of the offline-store sync (ADR-0014; spec 2026-10-16-offline-sync): the store calls it with its
// license key. Registered in the cloud only; the store side of the protocol comes with PR 4. The facts are applied
// by the appliers the owning modules register in SyncAppliers (core/sync), so this module imports no domain.
@Module({
  imports: [AuditModule],
  controllers: [SyncReceiveController],
  providers: [
    LicenseKeyGuard,
    SyncRunsRepository,
    SyncRunsService,
    InboxRepository,
    SyncApplyService,
  ],
})
export class SyncModule {}
