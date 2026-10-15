import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { AttentionController } from './attention.controller';
import { BillingRepository } from './billing.repository';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersRepository } from './service-orders.repository';
import { ServiceOrdersService } from './service-orders.service';
import { ServicesCatalogController } from './services-catalog.controller';
import { ServicesCatalogService } from './services-catalog.service';

// Billing of the platform for the operator contour (spec 2026-10-15-billing-services): settings,
// the service catalog, the requests and services of networks and the menu counter; invoices and
// payments come with PR 2. Cloud only: an offline store has no operator contour.
@Module({
  imports: [PlatformDatabaseModule, PlatformAuditModule],
  controllers: [
    PlatformSettingsController,
    ServicesCatalogController,
    ServiceOrdersController,
    AttentionController,
  ],
  providers: [
    BillingRepository,
    PlatformSettingsService,
    ServicesCatalogService,
    ServiceOrdersRepository,
    ServiceOrdersService,
  ],
})
export class PlatformBillingModule {}
