import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { SessionsModule } from '../../../core/sessions';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformStatsModule } from '../stats/platform-stats.module';
import { OperatorStoresController } from './operator-stores.controller';
import { TenantsController } from './tenants.controller';
import { TenantsRepository } from './tenants.repository';
import { TenantsService } from './tenants.service';

// Networks of the platform for the operator (spec 2026-10-05-tenants-module) and the card of their stores (spec
// 2026-10-23-admin-store-card-tenant-log; the month of a store — `StoreMonthSales` of `platform/stats`). Cloud
// only: an offline store has no operator contour.
@Module({
  imports: [
    PlatformDatabaseModule,
    SessionsModule,
    PlatformAuditModule,
    PlatformStatsModule,
  ],
  controllers: [TenantsController, OperatorStoresController],
  providers: [TenantsRepository, TenantsService],
})
export class TenantsModule {}
