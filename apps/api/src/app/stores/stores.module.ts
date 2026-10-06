import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LegalEntitiesController } from './legal-entities.controller';
import { LegalEntitiesService } from './legal-entities.service';
import { StoresController } from './stores.controller';
import { StoresRepository } from './stores.repository';
import { StoresService } from './stores.service';

// Stores and legal entities of the owner (spec 2026-10-06-owner-stores). Cloud only: an offline
// store receives them by the change feed (ADR-0014). TenantDatabase comes from the global
// DatabaseModule.
@Module({
  imports: [AuditModule],
  controllers: [StoresController, LegalEntitiesController],
  providers: [StoresRepository, StoresService, LegalEntitiesService],
})
export class StoresModule {}
