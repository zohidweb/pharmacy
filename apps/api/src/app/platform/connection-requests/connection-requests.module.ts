import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { SiteContentModule } from '../site-content/site-content.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ConnectionRequestRetention } from './connection-request-retention';
import { ConnectionRequestsController } from './connection-requests.controller';
import { ConnectionRequestsOverview } from './connection-requests-overview';
import { ConnectionRequestsRepository } from './connection-requests.repository';
import { ConnectionRequestsService } from './connection-requests.service';
import { PublicConnectionRequestsController } from './public-connection-requests.controller';

// The connection requests of the public site (ADR-0023, spec 2026-10-28-public-site-design, 6.4, 7.2–7.4, 8): the form
// of the site (`/api/v1/public/connection-requests`) and «Сайт → Заявки» of the admin. The consent binds to the privacy
// policy in force (`LegalDocumentsService` of `site-content`); similar networks come from `TenantLookup` and the creation
// of a network marks its request through the port `ConnectionRequestLinker` (both `platform/tenants`), so `tenants`
// never depends on this module. Exports the counter and the notification state (`ConnectionRequestsOverview` →
// `platform/notifications`) and the anonymization (`ConnectionRequestRetention` → `platform/retention`). Cloud only.
@Module({
  imports: [
    PlatformDatabaseModule,
    PlatformAuditModule,
    SiteContentModule,
    TenantsModule,
  ],
  controllers: [
    ConnectionRequestsController,
    PublicConnectionRequestsController,
  ],
  providers: [
    ConnectionRequestsRepository,
    ConnectionRequestsService,
    ConnectionRequestsOverview,
    ConnectionRequestRetention,
  ],
  exports: [ConnectionRequestsOverview, ConnectionRequestRetention],
})
export class ConnectionRequestsModule {}
