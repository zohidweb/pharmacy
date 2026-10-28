import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { SessionsModule } from '../../../core/sessions';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformStatsModule } from '../stats/platform-stats.module';
import { ConnectionRequestLinker } from './connection-request-linker';
import { OperatorStoresController } from './operator-stores.controller';
import { TenantLookup } from './tenant-lookup';
import { TenantsController } from './tenants.controller';
import { TenantsRepository } from './tenants.repository';
import { TenantsService } from './tenants.service';

// Networks of the platform for the operator (spec 2026-10-05-tenants-module) and the card of their stores (spec
// 2026-10-23-admin-store-card-tenant-log; the month of a store — `StoreMonthSales` of `platform/stats`). Cloud
// only: an offline store has no operator contour. For the connection requests of the site (ADR-0023) it exports
// `TenantLookup` (similar networks) and the port `ConnectionRequestLinker`, which `platform/connection-requests` fills.
@Module({
  imports: [
    PlatformDatabaseModule,
    SessionsModule,
    PlatformAuditModule,
    PlatformStatsModule,
  ],
  controllers: [TenantsController, OperatorStoresController],
  providers: [
    TenantsRepository,
    TenantsService,
    TenantLookup,
    ConnectionRequestLinker,
  ],
  exports: [TenantLookup, ConnectionRequestLinker],
})
export class TenantsModule {}
