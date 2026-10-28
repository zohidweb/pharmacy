import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformBillingModule } from '../billing/platform-billing.module';
import { ConnectionRequestsModule } from '../connection-requests/connection-requests.module';
import { PlatformStatsModule } from '../stats/platform-stats.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsRepository } from './announcements.repository';
import { AnnouncementsService } from './announcements.service';
import { AttentionController } from './attention.controller';
import { PlatformNotificationsController } from './notifications.controller';
import { PlatformNotificationsRefresh } from './notifications-refresh';
import { PlatformNotificationsRepository } from './notifications.repository';
import { PlatformNotificationsService } from './notifications.service';

// The notifications of the operators and the counters of the admin menu (spec
// 2026-10-19-operator-notifications). The states come from the queue of the dashboard (`OperatorQueue`,
// `platform/stats` → `platform/notifications`), the count of the requests from `platform/billing`
// (`BillingOverview`), the connection requests of the site from `platform/connection-requests`
// (`ConnectionRequestsOverview`: the counter «Заявки» and the state `connection_requested`). Announcements to
// networks: written here, read by the tenant module `notifications` from the shared table. Cloud only: an
// offline store has no operator contour.
@Module({
  imports: [
    PlatformDatabaseModule,
    PlatformAuditModule,
    PlatformBillingModule,
    PlatformStatsModule,
    ConnectionRequestsModule,
  ],
  controllers: [
    PlatformNotificationsController,
    AttentionController,
    AnnouncementsController,
  ],
  providers: [
    PlatformNotificationsRepository,
    PlatformNotificationsRefresh,
    PlatformNotificationsService,
    AnnouncementsRepository,
    AnnouncementsService,
  ],
})
export class PlatformNotificationsModule {}
