import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PlatformBillingModule } from '../billing/platform-billing.module';
import { PlatformStatsModule } from '../stats/platform-stats.module';
import { AttentionController } from './attention.controller';
import { PlatformNotificationsController } from './notifications.controller';
import { PlatformNotificationsRefresh } from './notifications-refresh';
import { PlatformNotificationsRepository } from './notifications.repository';
import { PlatformNotificationsService } from './notifications.service';

// The notifications of the operators and the counters of the admin menu (spec
// 2026-10-19-operator-notifications). The states come from the queue of the dashboard (`OperatorQueue`,
// `platform/stats` → `platform/notifications`), the count of the requests from `platform/billing`
// (`BillingOverview`). Cloud only: an offline store has no operator contour.
@Module({
  imports: [PlatformDatabaseModule, PlatformBillingModule, PlatformStatsModule],
  controllers: [PlatformNotificationsController, AttentionController],
  providers: [
    PlatformNotificationsRepository,
    PlatformNotificationsRefresh,
    PlatformNotificationsService,
  ],
})
export class PlatformNotificationsModule {}
