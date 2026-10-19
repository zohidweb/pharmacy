import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PosModule } from '../../pos/pos.module';
import { PlatformBillingModule } from '../billing/platform-billing.module';
import { StatsController } from './stats.controller';
import { StatsRepository } from './stats.repository';
import { StatsService } from './stats.service';

// The operator dashboard and the usage statistics (spec 2026-10-19-admin-dashboard-stats; ADR-0013,
// amendment 2026-10-19). The marts of a network are refreshed by `pos` (`StoreSalesExport`, `pos` →
// `platform/stats`), the invoices and requests come from `platform/billing` (`BillingOverview`). Cloud
// only: an offline store has no operator contour.
@Module({
  imports: [PlatformDatabaseModule, PlatformBillingModule, PosModule],
  controllers: [StatsController],
  providers: [StatsRepository, StatsService],
})
export class PlatformStatsModule {}
