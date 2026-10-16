/*
 * Mock handlers of «Дашборд», «Статистика», «Уведомления», «Журнал действий», «Настройки
 * платформы», «Профиль» and the sidebar counters.
 */
import { invoiceView } from './billing-ledger';
import type {
  OperatorQueueItem,
  UsageStoreRow,
  UsageTenantRow,
} from '@pharmacy/shared-dto';
import { passwordProblems } from '@pharmacy/shared-domain';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import { mockDb, mockStats } from './db';
import { demoOperator } from './fixtures';
import { notFound } from './helpers';
import { logAction } from './log-action';
import type { MockHandlers } from './types';

const system = () => mockDb().system;
const today = () => toAppDate();

// The e-mail shape of apps/api (identifier.ts) for an operator login.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The API's default ACTIVATION_CODE_TTL_HOURS.
function mockCodeExpiresAt(): string {
  return new Date(Date.now() + 72 * 3600_000).toISOString();
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

function lastPeriodInvoices(db: ReturnType<typeof mockDb>) {
  const last = db.billing.invoices
    .map((invoice) => invoice.period)
    .sort()
    .at(-1);
  return db.billing.invoices.filter((invoice) => invoice.period === last);
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
  | 'operators.issueCode'
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
    const overdue = db.billing.invoices
      .map(invoiceView)
      .filter((invoice) => invoice.overdue);
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
          amountMinor: invoice.remainingMinor,
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
        // the invoices of the last invoiced period
        accruedMinor: lastPeriodInvoices(db).reduce(
          (sum, invoice) => sum + invoice.totalMinor,
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
    logAction('announcement.published');
    return announcement;
  },
  'announcements.cancel': ({ params, correlationId }) => {
    const announcement = system().announcements.find(
      (item) => item.id === params.id,
    );
    if (!announcement) throw notFound(correlationId);
    announcement.status = 'cancelled';
    logAction('announcement.cancelled');
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
        // as the API: what the operator did and what was done to their account (auth3-M3)
        (!query?.operatorId ||
          (entry.actor.kind === 'operator' &&
            entry.actor.operatorId === query.operatorId) ||
          entry.operator?.id === query.operatorId) &&
        (!query?.tenantId || entry.tenant?.id === query.tenantId) &&
        (!query?.type || entry.type === query.type) &&
        // calendar days of the platform (Asia/Dushanbe), as apps/api
        (!query?.from || toAppDate(new Date(entry.at)) >= query.from) &&
        (!query?.to || toAppDate(new Date(entry.at)) <= query.to),
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
    logAction('settings.updated');
    return body;
  },
  'operators.list': () => system().operators,
  // As apps/api: the login is a work e-mail, unique; the code is shown once.
  'operators.create': ({ body, correlationId }) => {
    const login = body.login.trim().toLowerCase();
    if (!EMAIL.test(login)) {
      throw new ApiError(400, 'validation_failed', correlationId, [
        { field: 'login', code: 'email_format' },
      ]);
    }
    if (system().operators.some((item) => item.login === login)) {
      throw new ApiError(409, 'login_taken', correlationId, [
        { field: 'login', code: 'login_taken' },
      ]);
    }
    const operator = {
      id: `op-${Date.now()}`,
      fullName: body.fullName.trim(),
      login,
      role: 'full_access' as const,
      lastLoginAt: null,
      status: 'active' as const,
    };
    system().operators.push(operator);
    logAction('operator.code-issued', {
      operator: { id: operator.id, name: operator.fullName },
      details: { created: 'true' },
    });
    // Synthetic value: the real code is 128 bits of randomBytes (ADR-0008, amendment 2026-10-02).
    return {
      operator,
      activationCode: 'MOCKOPERATORCODE0000000000',
      activationCodeExpiresAt: mockCodeExpiresAt(),
    };
  },
  'operators.issueCode': ({ params, correlationId }) => {
    if (params.id === demoOperator.id)
      throw new ApiError(409, 'cannot_issue_self', correlationId);
    const operator = system().operators.find((item) => item.id === params.id);
    if (!operator) throw notFound(correlationId);
    if (operator.status !== 'active')
      throw new ApiError(409, 'operator_disabled', correlationId);
    logAction('operator.code-issued', {
      operator: { id: operator.id, name: operator.fullName },
      details: { created: 'false' },
    });
    return {
      activationCode: 'MOCKNEWOPERATORCODE0000000',
      activationCodeExpiresAt: mockCodeExpiresAt(),
    };
  },
  'operators.disable': ({ params, correlationId }) => {
    if (params.id === demoOperator.id)
      throw new ApiError(409, 'cannot_disable_self', correlationId);
    const operator = system().operators.find((item) => item.id === params.id);
    if (!operator) throw notFound(correlationId);
    if (operator.status !== 'active')
      throw new ApiError(409, 'already_disabled', correlationId);
    operator.status = 'disabled';
    logAction('operator.disabled', {
      operator: { id: operator.id, name: operator.fullName },
    });
    return operator;
  },

  'me.get': () => system().me,
  'me.update': ({ body }) => {
    const fullName = body.fullName.trim();
    const self = { id: demoOperator.id, name: fullName };
    if (fullName !== system().me.fullName) {
      logAction('operator.renamed', { operator: self });
    }
    Object.assign(system().me, { fullName, locale: body.locale });
    // The team list reads the same operator, as apps/api does.
    const listed = system().operators.find(
      (item) => item.id === demoOperator.id,
    );
    if (listed) listed.fullName = fullName;
    return system().me;
  },
  // As apps/api: the current password first (a field error), then the policy of the new one.
  'me.changePassword': ({ body, correlationId }) => {
    if (body.currentPassword !== system().password) {
      logAction('auth.operator-password-change-failed', {
        operator: { id: demoOperator.id, name: system().me.fullName },
        details: { reason: 'invalid_password' },
      });
      throw new ApiError(422, 'invalid_current_password', correlationId, [
        { field: 'currentPassword', code: 'invalid_current_password' },
      ]);
    }
    if (passwordProblems(body.newPassword).length > 0) {
      throw new ApiError(422, 'password_policy', correlationId);
    }
    system().password = body.newPassword;
    system().sessions = system().sessions.filter((session) => session.current);
    logAction('auth.operator-password-changed', {
      operator: { id: demoOperator.id, name: system().me.fullName },
    });
  },
  'me.sessions': () => system().sessions,
  'me.endOtherSessions': () => {
    system().sessions = system().sessions.filter((session) => session.current);
  },
  'me.activity': () =>
    system()
      .operatorAudit.filter(
        (entry) =>
          entry.actor.kind === 'operator' &&
          entry.actor.operatorId === demoOperator.id,
      )
      .slice(0, 5),
};
