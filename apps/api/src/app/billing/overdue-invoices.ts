import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { OwnerBillingRepository } from './owner-billing.repository';

export interface OverdueInvoice {
  id: string;
  number: string;
  remainingMinor: number;
  /** Date-only. */
  dueOn: string;
}

// The overdue invoices of a network, for its notifications (spec 2026-10-15-billing-services, A17:
// `invoice_overdue`, a state until the invoice is paid). Exported by BillingModule; read in the
// tenant transaction of the notifications refresh.
@Injectable()
export class OverdueInvoices {
  constructor(private readonly repository: OwnerBillingRepository) {}

  async list(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<OverdueInvoice[]> {
    const rows = await this.repository.overdue(trx, tenantId);
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      remainingMinor: Number(row.remainingDirams),
      dueOn: row.dueOn,
    }));
  }
}
