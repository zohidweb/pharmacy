import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { BillingRepository } from './billing.repository';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { ServicesCatalogController } from './services-catalog.controller';
import { ServicesCatalogService } from './services-catalog.service';

// Billing of the platform for the operator contour (spec 2026-10-15-billing-services): settings,
// the service catalog and the services of networks; invoices and payments come with PR 2. Cloud
// only: an offline store has no operator contour.
@Module({
  imports: [PlatformDatabaseModule, PlatformAuditModule],
  controllers: [PlatformSettingsController, ServicesCatalogController],
  providers: [
    BillingRepository,
    PlatformSettingsService,
    ServicesCatalogService,
  ],
})
export class PlatformBillingModule {}
