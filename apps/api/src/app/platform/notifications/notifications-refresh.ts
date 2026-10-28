import { Injectable } from '@nestjs/common';
import type { EventKind } from '@pharmacy/shared-dto';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';
import { ConnectionRequestsOverview } from '../connection-requests/connection-requests-overview';
import { OperatorQueue } from '../stats/operator-queue';
import {
  type NewPlatformNotification,
  PlatformNotificationsRepository,
} from './notifications.repository';

const REFRESH_MS = 5 * 60_000;
// a payment or a revocation committed a little after the last mark is not lost: the keys make a repeat
// harmless (as the notifications of the owner)
const EVENTS_OVERLAP_MS = 5 * 60_000;
// the first refresh reads the events of the days the list shows (N4)
const FIRST_LOOKBACK_MS = 30 * 86_400_000;

// The notifications of the operators are refreshed on read (spec 2026-10-19-operator-notifications, N2,
// section 4): no background jobs in the cloud. One refresh at a time; states come from the queue of the
// dashboard (`OperatorQueue`), so the two never disagree; events from the payments and the revoked keys
// written after the previous mark.
@Injectable()
export class PlatformNotificationsRefresh {
  constructor(
    private readonly repository: PlatformNotificationsRepository,
    private readonly queue: OperatorQueue,
    private readonly leads: ConnectionRequestsOverview,
  ) {}

  /** Refreshes when the last refresh is older than 5 minutes and no other request is refreshing. */
  async run(trx: Transaction<DB>): Promise<void> {
    const last = await this.repository.lastRefresh(trx);
    if (last && Date.now() - last.refreshedAt.getTime() < REFRESH_MS) return;
    if (!(await this.repository.tryLock(trx))) return;
    const today = await this.repository.today(trx);

    const overdue = await this.queue.overdueInvoices(trx, today);
    await this.states(
      trx,
      'invoice_overdue',
      overdue.map((invoice) => ({
        kind: 'invoice_overdue',
        dedupeKey: `invoice:${invoice.id}`,
        tenantId: invoice.tenantId,
        storeId: null,
        entityType: 'invoice',
        entityId: invoice.id,
        params: {
          tenantName: invoice.tenantName,
          invoiceNumber: invoice.number,
          amountMinor: invoice.remainingMinor,
        },
      })),
    );
    const keys = await this.queue.expiringKeys(trx, today);
    await this.states(
      trx,
      'key_expiring',
      keys.map((key) => ({
        kind: 'key_expiring',
        dedupeKey: `key:${key.id}`,
        tenantId: key.tenantId,
        storeId: null,
        entityType: 'license_key',
        entityId: key.id,
        params: {
          tenantName: key.tenantName,
          storeName: key.storeName,
          days: key.days,
        },
      })),
    );
    const stale = await this.queue.staleStores(trx, today);
    await this.states(
      trx,
      'sync_stale',
      stale.map((store) => ({
        kind: 'sync_stale',
        dedupeKey: `sync:${store.storeId}`,
        tenantId: store.tenantId,
        storeId: store.storeId,
        entityType: 'store',
        entityId: store.storeId,
        params: {
          tenantName: store.tenantName,
          storeName: store.storeName,
          days: store.days,
        },
      })),
    );
    const requests = await this.queue.pendingRequests(trx);
    await this.states(
      trx,
      'service_requested',
      requests.map((request) => ({
        kind: 'service_requested',
        dedupeKey: `request:${request.id}`,
        tenantId: request.tenantId,
        storeId: null,
        entityType: 'service_request',
        entityId: request.id,
        params: {
          tenantName: request.tenantName,
          serviceName: request.serviceName,
        },
      })),
    );
    // a request of the site nobody has taken yet (spec 2026-10-28-public-site-design, 7.4); not a network yet
    const leads = await this.leads.newRequests(trx);
    await this.states(
      trx,
      'connection_requested',
      leads.map((lead) => ({
        kind: 'connection_requested',
        dedupeKey: `connection-request:${lead.id}`,
        tenantId: null,
        storeId: null,
        entityType: 'connection_request',
        entityId: lead.id,
        params: { tenantName: lead.networkName },
      })),
    );

    const after = new Date(
      last
        ? last.eventsAfter.getTime() - EVENTS_OVERLAP_MS
        : Date.now() - FIRST_LOOKBACK_MS,
    );
    const payments = await this.repository.payments(trx, after);
    await this.repository.insertEvents(
      trx,
      payments.map((payment) => ({
        kind: 'payment_recorded',
        dedupeKey: `payment:${payment.id}`,
        tenantId: payment.tenantId,
        storeId: null,
        entityType: 'tenant_payment',
        entityId: payment.id,
        params: {
          tenantName: payment.tenantName,
          amountMinor: Number(payment.amount),
        },
        createdAt: payment.createdAt,
        authorId: payment.recordedBy,
      })),
    );
    const revoked = await this.repository.revokedKeys(trx, after);
    await this.repository.insertEvents(
      trx,
      revoked.map((key) => ({
        kind: 'key_revoked',
        dedupeKey: `revoked:${key.id}`,
        tenantId: key.tenantId,
        storeId: key.storeId,
        entityType: 'license_key',
        entityId: key.id,
        params: { tenantName: key.tenantName, storeName: key.storeName },
        createdAt: key.revokedAt,
        authorId: key.revokedBy,
      })),
    );
    await this.repository.markRefreshed(trx);
  }

  private async states(
    trx: Transaction<DB>,
    kind: EventKind,
    items: NewPlatformNotification[],
  ): Promise<void> {
    await this.repository.upsertStates(trx, items);
    await this.repository.resolveMissing(
      trx,
      kind,
      items.map((item) => item.dedupeKey),
    );
  }
}
