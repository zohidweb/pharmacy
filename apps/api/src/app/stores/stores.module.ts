import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LegalEntitiesController } from './legal-entities.controller';
import { LegalEntitiesService } from './legal-entities.service';
import { NetworkSettingsRepository } from './network-settings.repository';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StoresController } from './stores.controller';
import { StoresRepository } from './stores.repository';
import { StoresService } from './stores.service';

// Stores and legal entities of the owner (spec 2026-10-06-owner-stores) and the network settings of
// the owner cabinet (spec 2026-10-14-owner-cabinet, E14). Cloud only: an offline
// store receives them by the change feed (ADR-0014). TenantDatabase comes from the global
// DatabaseModule.
@Module({
  imports: [AuditModule],
  controllers: [StoresController, LegalEntitiesController, SettingsController],
  providers: [
    StoresRepository,
    StoresService,
    LegalEntitiesService,
    NetworkSettingsRepository,
    SettingsService,
  ],
})
export class StoresModule {}
