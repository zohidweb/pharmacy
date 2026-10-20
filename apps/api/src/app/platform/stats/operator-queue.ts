import { Injectable } from '@nestjs/common';
import type { ServiceRequestItem } from '@pharmacy/shared-dto';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';
import { BillingOverview } from '../billing/billing-overview';
import {
  type ExpiringKey,
  type StaleStore,
  StatsRepository,
} from './stats.repository';

export type { ExpiringKey, StaleStore };

// The states that ask for an operator (spec 2026-10-19-admin-dashboard-stats, D13; spec
// 2026-10-19-operator-notifications, N3): overdue invoices, expiring and expired keys of offline stores,
// offline stores without a sync for more than 7 days and requests without a decision. One source, so
// the queue of the dashboard and the operator notifications never disagree. Exported by
// PlatformStatsModule (`platform/stats` → `platform/notifications`); runs in the platform transaction of
// the caller.
@Injectable()
export class OperatorQueue {
  constructor(
    private readonly billing: BillingOverview,
    private readonly repository: StatsRepository,
  ) {}

  overdueInvoices(trx: Transaction<DB>, today: string) {
    return this.billing.overdueInvoices(trx, today);
  }

  expiringKeys(trx: Transaction<DB>, today: string): Promise<ExpiringKey[]> {
    return this.repository.expiringKeys(trx, today);
  }

  staleStores(trx: Transaction<DB>, today: string): Promise<StaleStore[]> {
    return this.repository.staleStores(trx, today);
  }

  /** The oldest request first. */
  pendingRequests(trx: Transaction<DB>): Promise<ServiceRequestItem[]> {
    return this.billing.pendingRequests(trx);
  }
}
