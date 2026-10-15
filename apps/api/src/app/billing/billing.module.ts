import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OwnerServicesController } from './owner-services.controller';
import { OwnerServicesRepository } from './owner-services.repository';
import { OwnerServicesService } from './owner-services.service';
import { ServiceDecisions } from './service-decisions';

// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`.
// Billing of a network (spec 2026-10-15-billing-services, 6.2): the services the owner orders from
// the operator's catalog; the invoices of the network come with PR 2/3. Exports the operator's
// decisions for the notifications (`billing` ← `notifications`). Cloud only, as the platform side.
@Module({
  imports: [AuditModule],
  controllers: [OwnerServicesController],
  providers: [OwnerServicesRepository, OwnerServicesService, ServiceDecisions],
  exports: [ServiceDecisions],
})
export class BillingModule {}
