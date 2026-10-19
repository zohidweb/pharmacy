import { Injectable } from '@nestjs/common';
import type { ServiceRequestItem } from '@pharmacy/shared-dto';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';
import { InvoicesRepository } from './invoices.repository';
import { ServiceOrdersRepository } from './service-orders.repository';

// What the operator dashboard needs of the billing (spec 2026-10-19-admin-dashboard-stats, D12, D13):
// the last invoiced period, the overdue invoices and the requests without a decision — the same
// queries as «Счета» and «Услуги». Exported by PlatformBillingModule (`platform/billing` →
// `platform/stats`); runs in the platform transaction of the caller.
@Injectable()
export class BillingOverview {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly orders: ServiceOrdersRepository,
  ) {}

  lastInvoicedPeriod(
    trx: Transaction<DB>,
  ): Promise<{ period: string; totalMinor: number } | null> {
    return this.invoices.lastInvoicedPeriod(trx);
  }

  overdueInvoices(trx: Transaction<DB>, today: string) {
    return this.invoices.overdue(trx, today);
  }

  /** The oldest request first. */
  pendingRequests(trx: Transaction<DB>): Promise<ServiceRequestItem[]> {
    return this.orders.pendingRequests(trx);
  }
}
