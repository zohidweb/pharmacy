import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { StoreUsageRepository } from './store-usage.repository';

// The activity of the stores of a network in a month, for the invoices of the platform (spec
// 2026-10-15-billing-services, 5; ADR-0013, amendment 2026-10-15): the platform module calls it for
// each network in turn, and it runs in the context of that network under pharmacy_app (RLS), with
// no principal, as a background task of a tenant. Exported by BillingModule
// (`billing` → `platform/billing`).
@Injectable()
export class StoreUsage {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: StoreUsageRepository,
  ) {}

  /** Rewrites store_usage_monthly of the network for `month` (YYYY-MM-01) in its own transaction. */
  async refresh(tenantId: string, month: string): Promise<void> {
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    await runWithContext({ correlationId, tenantId, principal: null }, () =>
      this.db.tenantTransaction((trx) =>
        this.repository.refresh(trx, tenantId, month),
      ),
    );
  }
}
