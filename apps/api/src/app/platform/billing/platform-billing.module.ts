import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { BillingModule } from '../../billing/billing.module';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { TenantAllocation } from './allocation';
import { AttentionController } from './attention.controller';
import { BillingRepository } from './billing.repository';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersRepository } from './service-orders.repository';
import { ServiceOrdersService } from './service-orders.service';
import { ServicesCatalogController } from './services-catalog.controller';
import { ServicesCatalogService } from './services-catalog.service';

// Billing of the platform for the operator contour (spec 2026-10-15-billing-services): settings,
// the service catalog, the requests and services of networks, the menu counter, invoices, payments
// and discounts of networks. The activity of stores comes from the tenant module `billing`
// (`StoreUsage`, `billing` → `platform/billing`). Cloud only: an offline store has no operator
// contour.
@Module({
  imports: [PlatformDatabaseModule, PlatformAuditModule, BillingModule],
  controllers: [
    PlatformSettingsController,
    ServicesCatalogController,
    ServiceOrdersController,
    AttentionController,
    InvoicesController,
    PaymentsController,
    DiscountsController,
  ],
  providers: [
    BillingRepository,
    PlatformSettingsService,
    ServicesCatalogService,
    ServiceOrdersRepository,
    ServiceOrdersService,
    InvoicesRepository,
    InvoicesService,
    TenantAllocation,
    PaymentsRepository,
    PaymentsService,
    DiscountsService,
  ],
})
export class PlatformBillingModule {}
