/*
 * Mock handlers of «Дашборд», «Статистика», «Уведомления», «Журнал действий», «Настройки
 * платформы», «Профиль» and the sidebar counters.
 */
import type {
  OperatorAuditEntry,
  OperatorQueueItem,
  UsageStoreRow,
  UsageTenantRow,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import { mockDb, mockStats } from './db';
import { demoOperator } from './fixtures';
import { notFound } from './helpers';
import type { MockHandlers } from './types';

const system = () => mockDb().system;
const today = () => toAppDate();

function logAction(
  entry: Omit<OperatorAuditEntry, 'id' | 'at' | 'operatorId' | 'operatorName'>,
) {
  system().operatorAudit.unshift({
    ...entry,
    id: `oa-${Date.now()}`,
    at: new Date().toISOString(),
    operatorId: demoOperator.id,
    operatorName: demoOperator.fullName,
  });
}

function expiringLicenses() {
  return mockDb().billing.licenses.filter((license) => {
    if (license.state === 'revoked') return false;
    const left = daysBetween(today(), license.validUntil);
    return left >= 0 && left <= license.notifyDaysBefore;
  });
}

function staleStores() {
  return mockDb().stores.filter(
    (store) =>
      store.mode === 'offline' &&
      store.status === 'active' &&
      (!store.lastSyncAt ||
        daysBetween(toAppDate(new Date(store.lastSyncAt)), today()) >= 3),
  );
}

function storeRow(storeId: string): UsageStoreRow | null {
  const store = mockDb().stores.find((item) => item.id === storeId);
  if (!store || store.status !== 'active') return null;
  return {
    storeId: store.id,
    storeName: store.name,
    mode: store.mode,
    receipts: store.monthReceipts,
    salesMinor: store.monthSalesMinor,
    averageReceiptMinor:
      store.monthReceipts > 0
        ? Math.round(store.monthSalesMinor / store.monthReceipts)
        : 0,
    lastActivityAt:
      store.mode === 'offline' ? store.lastSyncAt : '2026-10-01T05:50:00Z',
  };
}

export const systemHandlers: Pick<
  MockHandlers,
  | 'attention.counts'
  | 'dashboard.get'
  | 'usage.stats'
  | 'notifications.list'
  | 'notifications.readAll'
  | 'announcements.list'
  | 'announcements.create'
  | 'announcements.cancel'
  | 'me.notificationPreferences'
  | 'me.updateNotificationPreferences'
  | 'operatorAudit.list'
  | 'settings.get'
  | 'settings.update'
  | 'operators.list'
  | 'operators.create'
  | 'operators.disable'
  | 'me.get'
  | 'me.update'
  | 'me.changePassword'
  | 'me.sessions'
  | 'me.endOtherSessions'
  | 'me.activity'
> = {
  'attention.counts': () => ({
    serviceRequests: mockDb().billing.serviceRequests.length,
    expiringLicenses: expiringLicenses().length,
    unreadNotifications: system().notifications.filter((item) => !item.read)
      .length,
  }),
  'dashboard.get': () => {
    const db = mockDb();
    const active = db.stores.filter((store) => store.status === 'active');
    const overdue = db.billing.invoices.filter(
      (invoice) => invoice.status === 'overdue',
    );
    const sales = new Map<string, number>();
    for (const tenant of db.tenants) {
      for (const day of mockStats(tenant.id).daily) {
        sales.set(day.date, (sales.get(day.date) ?? 0) + day.salesMinor);
      }
    }
    const queue: OperatorQueueItem[] = [
      ...overdue.map((invoice) => ({
        id: `q-${invoice.id}`,
        kind: 'invoice_overdue' as const,
        params: {
          tenantName: invoice.tenantName,
          invoiceNumber: invoice.number,
          amountMinor: invoice.totalMinor,
        },
        target: { screen: 'tenant' as const, id: invoice.tenantId },
        at: `${invoice.dueOn}T00:00:00Z`,
      })),
      ...expiringLicenses().map((license) => ({
        id: `q-${license.id}`,
        kind: 'key_expiring' as const,
        params: {
          storeName: license.storeName,
          days: daysBetween(today(), license.validUntil),
        },
        target: { screen: 'store' as const, id: license.storeId },
        at: new Date().toISOString(),
      })),
      ...db.billing.serviceRequests.map((request) => ({
        id: `q-${request.id}`,
        kind: 'service_requested' as const,
        params: {
          tenantName: request.tenantName,
          serviceName: request.serviceName,
        },
        target: { screen: 'services' as const },
        at: request.requestedAt,
      })),
      ...staleStores().map((store) => ({
        id: `q-${store.id}`,
        kind: 'sync_stale' as const,
        params: {
          storeName: store.name,
          days: store.lastSyncAt
            ? daysBetween(toAppDate(new Date(store.lastSyncAt)), today())
            : 0,
        },
        target: { screen: 'store' as const, id: store.id },
        at: store.lastSyncAt ?? new Date().toISOString(),
      })),
    ];
    return {
      summary: {
        tenants: db.tenants.length,
        activeTenants: db.tenants.filter((tenant) => tenant.status === 'active')
          .length,
        cloudStores: active.filter((store) => store.mode === 'cloud').length,
        offlineStores: active.filter((store) => store.mode === 'offline')
          .length,
        accruedMinor: db.tenants.reduce(
          (sum, tenant) => sum + tenant.monthlyChargeMinor,
          0,
        ),
        attention: {
          overdueInvoices: overdue.length,
          expiringKeys: expiringLicenses().length,
          serviceRequests: db.billing.serviceRequests.length,
          staleSync: staleStores().length,
        },
      },
      sales: [...sales.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, salesMinor]) => ({ date, salesMinor })),
      queue,
    };
  },
  'usage.stats': ({ query }) => {
    const rows: UsageTenantRow[] = mockDb()
      .tenants.filter(
        (tenant) => !query.tenantId || tenant.id === query.tenantId,
      )
      .map((tenant) => {
        const stores = mockDb()
          .stores.filter((store) => store.tenantId === tenant.id)
          .map((store) => storeRow(store.id))
          .filter((row): row is UsageStoreRow => row !== null);
        const receipts = stores.reduce((sum, row) => sum + row.receipts, 0);
        const salesMinor = stores.reduce((sum, row) => sum + row.salesMinor, 0);
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          receipts,
          salesMinor,
          averageReceiptMinor:
            receipts > 0 ? Math.round(salesMinor / receipts) : 0,
          lastActivityAt:
            stores
              .map((row) => row.lastActivityAt)
              .filter(Boolean)
              .sort()
              .at(-1) ?? null,
          stores,
        };
      });
    const receipts = rows.reduce((sum, row) => sum + row.receipts, 0);
    const salesMinor = rows.reduce((sum, row) => sum + row.salesMinor, 0);
    const cashiers = mockDb()
      .stores.filter(
        (store) =>
          store.status === 'active' &&
          (!query.tenantId || store.tenantId === query.tenantId),
      )
      .reduce((sum, store) => sum + store.cashiers, 0);
    return {
      period: query.period,
      kpi: {
        receipts,
        salesMinor,
        averageReceiptMinor:
          receipts > 0 ? Math.round(salesMinor / receipts) : 0,
        activeCashiers: cashiers,
      },
      rows,
    };
  },

  'notifications.list': ({ query }) => {
    const all = [...system().notifications].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const items = query?.topic
      ? all.filter((item) => item.topic === query.topic)
      : all;
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    const count = (topic: string) =>
      all.filter((item) => item.topic === topic).length;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      counts: {
        all: all.length,
        billing: count('billing'),
        keys: count('keys'),
        services: count('services'),
        sync: count('sync'),
      },
      unread: all.filter((item) => !item.read).length,
    };
  },
  'notifications.readAll': () => {
    system().notifications.forEach((item) => {
      item.read = true;
    });
  },
  'announcements.list': () =>
    system().announcements.filter((item) => item.status !== 'cancelled'),
  'announcements.create': ({ body, correlationId }) => {
    if (body.endsAt <= body.startsAt) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'endsAt', code: 'before_start' },
      ]);
    }
    const announcement = {
      ...body,
      id: `an-${Date.now()}`,
      status:
        body.startsAt > new Date().toISOString()
          ? ('scheduled' as const)
          : ('published' as const),
    };
    system().announcements.unshift(announcement);
    logAction({
      type: 'settings',
      targetLabel: 'Платформа',
      description: `Опубликовано объявление «${body.title}»`,
    });
    return announcement;
  },
  'announcements.cancel': ({ params, correlationId }) => {
    const announcement = system().announcements.find(
      (item) => item.id === params.id,
    );
    if (!announcement) throw notFound(correlationId);
    announcement.status = 'cancelled';
    logAction({
      type: 'settings',
      targetLabel: 'Платформа',
      description: `Снято объявление «${announcement.title}»`,
    });
    return announcement;
  },
  'me.notificationPreferences': () => system().preferences,
  'me.updateNotificationPreferences': ({ body }) => {
    system().preferences = body;
    return body;
  },

  'operatorAudit.list': ({ query }) => {
    const items = system().operatorAudit.filter(
      (entry) =>
        (!query?.operatorId || entry.operatorId === query.operatorId) &&
        (!query?.type || entry.type === query.type) &&
        (!query?.from || entry.at.slice(0, 10) >= query.from) &&
        (!query?.to || entry.at.slice(0, 10) <= query.to),
    );
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },

  'settings.get': () => system().settings,
  'settings.update': ({ body }) => {
    system().settings = body;
    logAction({
      type: 'settings',
      targetLabel: 'Платформа',
      description: 'Изменены настройки платформы',
    });
    return body;
  },
  'operators.list': () => system().operators,
  'operators.create': ({ body, correlationId }) => {
    if (system().operators.some((item) => item.login === body.login)) {
      throw new ApiError(409, 'login_taken', correlationId, [
        { field: 'login', code: 'taken' },
      ]);
    }
    const operator = {
      id: `op-${Date.now()}`,
      fullName: body.fullName,
      login: body.login,
      role: 'full_access' as const,
      lastLoginAt: null,
      status: 'active' as const,
    };
    system().operators.push(operator);
    logAction({
      type: 'settings',
      targetLabel: 'Платформа',
      description: `Добавлен оператор ${body.fullName}`,
    });
    return operator;
  },
  'operators.disable': ({ params, correlationId }) => {
    const operator = system().operators.find((item) => item.id === params.id);
    if (!operator) throw notFound(correlationId);
    if (operator.id === demoOperator.id)
      throw new ApiError(409, 'cannot_disable_self', correlationId);
    operator.status = 'disabled';
    logAction({
      type: 'settings',
      targetLabel: 'Платформа',
      description: `Отключён оператор ${operator.fullName}`,
    });
    return operator;
  },

  'me.get': () => system().me,
  'me.update': ({ body }) => {
    Object.assign(system().me, body);
    return system().me;
  },
  'me.changePassword': ({ body, correlationId }) => {
    if (body.currentPassword !== system().password) {
      throw new ApiError(422, 'wrong_password', correlationId, [
        { field: 'currentPassword', code: 'wrong' },
      ]);
    }
    system().password = body.newPassword;
    system().sessions = system().sessions.filter((session) => session.current);
  },
  'me.sessions': () => system().sessions,
  'me.endOtherSessions': () => {
    system().sessions = system().sessions.filter((session) => session.current);
  },
  'me.activity': () =>
    system()
      .operatorAudit.filter((entry) => entry.operatorId === demoOperator.id)
      .slice(0, 5)
      .map(({ id, at, description }) => ({ id, at, description })),
};
