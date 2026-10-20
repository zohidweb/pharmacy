import { Injectable } from '@nestjs/common';
import type {
  AttentionCounts,
  NotificationListQuery,
  NotificationListResponse,
  NotificationPreferences,
  NotificationTopic,
} from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { PlatformDatabase } from '../../../core/database/platform';
import { BillingOverview } from '../billing/billing-overview';
import {
  kindsOf,
  NOTIFICATION_TOPICS,
  targetOf,
  topicOf,
} from './notification-topics';
import { PlatformNotificationsRefresh } from './notifications-refresh';
import { PlatformNotificationsRepository } from './notifications.repository';

const DEFAULT_LIMIT = 20;

// The notifications of an operator, the bell preferences and the menu counters (spec
// 2026-10-19-operator-notifications, N2, N6–N9). Every read refreshes the notifications first when the
// last refresh is older than 5 minutes (its own platform transaction).
@Injectable()
export class PlatformNotificationsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: PlatformNotificationsRepository,
    private readonly refresh: PlatformNotificationsRefresh,
    private readonly billing: BillingOverview,
  ) {}

  private operatorId(): string {
    return requireOperator().operatorId;
  }

  private actor() {
    return { kind: 'operator' as const, operatorId: this.operatorId() };
  }

  private async refreshIfStale(): Promise<void> {
    await this.db.platformTransaction(this.actor(), (trx) =>
      this.refresh.run(trx),
    );
  }

  async list(query: NotificationListQuery): Promise<NotificationListResponse> {
    await this.refreshIfStale();
    const operatorId = this.operatorId();
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const muted = query.bell
        ? await this.repository.muted(trx, operatorId)
        : [];
      const topics = (query.topic ? [query.topic] : NOTIFICATION_TOPICS).filter(
        (topic) => !muted.includes(topic),
      );
      const byKind = await this.repository.countsByKind(trx);
      const counts = { all: 0, billing: 0, keys: 0, services: 0, sync: 0 };
      for (const [kind, n] of byKind) {
        counts[topicOf(kind)] += n;
        counts.all += n;
      }
      const page = await this.repository.list(
        trx,
        operatorId,
        kindsOf(topics),
        {
          limit,
          offset,
        },
      );
      return {
        items: page.rows.map((row) => ({
          id: row.id,
          topic: topicOf(row.kind),
          kind: row.kind,
          params: row.params,
          target: targetOf(row.kind, row.tenantId),
          createdAt: new Date(row.createdAt).toISOString(),
          read: row.read,
        })),
        total: page.total,
        limit,
        offset,
        counts,
        unread: page.unread,
      };
    });
  }

  async readAll(): Promise<void> {
    await this.refreshIfStale();
    const operatorId = this.operatorId();
    await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.markAllRead(trx, operatorId),
    );
  }

  /** The counters of the menu: requests without a decision and the unread of the bell topics (N9). */
  async attention(): Promise<AttentionCounts> {
    await this.refreshIfStale();
    const operatorId = this.operatorId();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const muted = await this.repository.muted(trx, operatorId);
      const kinds = kindsOf(
        NOTIFICATION_TOPICS.filter((topic) => !muted.includes(topic)),
      );
      const page = await this.repository.list(trx, operatorId, kinds, {
        limit: 1,
        offset: 0,
      });
      return {
        serviceRequests: await this.billing.pendingCount(trx),
        // the keys screen comes with the offline sync (stage 6)
        expiringLicenses: 0,
        unreadNotifications: page.unread,
      };
    });
  }

  async preferences(): Promise<NotificationPreferences> {
    const operatorId = this.operatorId();
    const muted = await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.muted(trx, operatorId),
    );
    return preferencesOf(muted);
  }

  async updatePreferences(
    next: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    const operatorId = this.operatorId();
    const muted = NOTIFICATION_TOPICS.filter((topic) => !next[topic]);
    await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.setMuted(trx, operatorId, muted),
    );
    return preferencesOf(muted);
  }
}

function preferencesOf(
  muted: readonly NotificationTopic[],
): NotificationPreferences {
  return {
    billing: !muted.includes('billing'),
    keys: !muted.includes('keys'),
    services: !muted.includes('services'),
    sync: !muted.includes('sync'),
  };
}
