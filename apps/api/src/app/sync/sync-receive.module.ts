import { Module } from '@nestjs/common';
import { LicenseKeyGuard } from './license-key.guard';
import { SyncReceiveController } from './sync-receive.controller';
import { SyncModule } from './sync.module';

// The routes of the sync contour, /api/v1/sync/* (ADR-0014 §6): registered only in the cloud and only with
// OFFLINE_SYNC_ENABLED=true (security review 2026-10-22, decision 7.4 — off while the network has no offline stores),
// together with their body parser in main.ts. SyncModule stays without routes: the platform retention imports it for
// the purge of the envelopes.
@Module({
  imports: [SyncModule],
  controllers: [SyncReceiveController],
  providers: [LicenseKeyGuard],
})
export class SyncReceiveModule {}
