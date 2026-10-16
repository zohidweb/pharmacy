import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { InvoiceDetails, TenantBilling } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { OwnerBillingService } from './owner-billing.service';

// The «Оплата» of the owner cabinet (spec 2026-10-15-billing-services, A19, 6.2).
@Controller({ path: 'billing', version: '1' })
export class OwnerBillingController {
  constructor(private readonly billing: OwnerBillingService) {}

  /** The estimate of the current month, the debt, the advance, the discounts and the invoices. */
  @RequirePermission('billing:view')
  @Get()
  get(): Promise<TenantBilling> {
    return this.billing.billing();
  }

  /** The invoice with its lines and snapshot, for print; 404 — no such invoice of the network. */
  @RequirePermission('billing:view')
  @Get('invoices/:id')
  invoice(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InvoiceDetails> {
    return this.billing.invoice(id);
  }
}
