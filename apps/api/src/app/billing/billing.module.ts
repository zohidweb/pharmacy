import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OwnerServicesController } from './owner-services.controller';
import { OwnerServicesRepository } from './owner-services.repository';
import { OwnerServicesService } from './owner-services.service';
import { ServiceDecisions } from './service-decisions';
import { StoreUsage } from './store-usage';
import { StoreUsageRepository } from './store-usage.repository';

// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`.
// Billing of a network (spec 2026-10-15-billing-services, 6.2): the services the owner orders from
// the operator's catalog; the owner's invoices come with PR 3. Exports the operator's decisions for
// the notifications (`billing` ← `notifications`) and the activity of the stores for the invoices of
// the platform (`billing` → `platform/billing`). Cloud only, as the platform side.
@Module({
  imports: [AuditModule],
  controllers: [OwnerServicesController],
  providers: [
    OwnerServicesRepository,
    OwnerServicesService,
    ServiceDecisions,
    StoreUsageRepository,
    StoreUsage,
  ],
  exports: [ServiceDecisions, StoreUsage],
})
export class BillingModule {}
