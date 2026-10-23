/*
 * In-memory mock transport: answers the same routes and errors (problem codes) as apps/api will,
 * so screens are built against the real contract — including the rules the server enforces:
 * permissions and store scope (ADR-0018), PIN only on a bound terminal and PIN lock after three
 * failures (ADR-0008). The mock session lives in sessionStorage to survive
 * a reload in development. Enabled only by NEXT_PUBLIC_API_MOCKS=true.
 */
import {
  checkPin,
  hasPermissions,
  isTrivialPin,
  passwordProblems,
  type Permission,
} from '@pharmacy/shared-domain';
import type {
  DashboardQuery,
  EmployeeMe,
  EmployeeSession,
  NotificationKind,
  TenantDashboard,
  TenantNotification,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError, type ApiTransport } from '../client';
import type { ApiBody, ApiParams, ApiQuery, ApiResponse } from '../routes';
import { mockDb, type MockEmployeeState } from './db';
import { storeDay, stores, tenant } from './fixtures';
import {
  authorize,
  current,
  employeeStores,
  startSession,
  toSession,
  writeSession,
} from './session';
import { catalogHandlers, priceProblems } from './handlers-catalog';
import { ownerHandlers } from './handlers-owner';
import { posHandlers } from './handlers-pos';
import { purchasingHandlers } from './handlers-purchasing';
import { staffHandlers } from './handlers-staff';
import {
  incomingTransfers,
  inScope,
  reorderLines,
  stockHandlers,
} from './handlers-stock';
import type { MockHandlers, MockRequest } from './types';

/** Simulated network latency in development; none in tests (fast, deterministic). */
const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 300;
const PIN_MAX_FAILURES = 3;
/** The one-time activation code the mocks accept for any demo login. */
export const MOCK_ACTIVATION_CODE = 'DEMOACTIVATIONCODE00000000';

// the kinds a notification needs a permission of, besides `notifications:view` (E10)
const KIND_PERMISSION: Record<NotificationKind, Permission> = {
  batch_expiring: 'inventory:view',
  low_stock: 'inventory:view',
  negative_stock: 'inventory:view',
  transfer_in_transit: 'inventory:view',
  supplier_payment_due: 'purchasing:view',
  shift_discrepancy: 'shifts:view',
  receipt_discrepancy: 'shifts:view',
  login_locked: 'employees:update',
  sync_conflict: 'sync:view',
  license_expiring: 'stores:view',
  service_decided: 'services:view',
  invoice_overdue: 'billing:view',
};

/** The notifications the employee receives, newest first, with their own read marks. */
function notificationsOf(session: EmployeeSession): TenantNotification[] {
  const enabled = mockDb().owner.settings.notifications;
  const storeIds = session.stores.map((store) => store.id);
  const canSeeCost = hasPermissions(session.permissions, 'finance:view-cost');
  return mockDb()
    .notifications.filter(
      (n) =>
        enabled[n.kind] &&
        hasPermissions(session.permissions, KIND_PERMISSION[n.kind]) &&
        (n.storeId === null
          ? session.scope === 'network'
          : storeIds.includes(n.storeId)),
    )
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .map(({ readBy, read, params, ...rest }) => {
      const { amountMinor, ...shown } = params;
      // as the API: a cash discrepancy is no purchase amount; an invoice's remainder is for whoever
      // sees the billing of the network
      const canSeeAmount =
        canSeeCost ||
        rest.kind === 'shift_discrepancy' ||
        (rest.kind === 'invoice_overdue' &&
          hasPermissions(session.permissions, 'billing:view'));
      return {
        ...rest,
        params:
          canSeeAmount && amountMinor !== undefined
            ? { ...shown, amountMinor }
            : shown,
        read: read || readBy.includes(session.employee.id),
      };
    });
}

/** YYYY-MM-DD `days` days before `date`. */
function daysBefore(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
}

/** The dates of a period of the home (spec 2026-10-14-owner-cabinet, E1, E6). */
function periodDates(
  query: DashboardQuery,
  correlationId: string,
): { from: string; to: string; chartFrom: string } {
  const today = toAppDate();
  if (query.period === 'today') {
    return { from: today, to: today, chartFrom: daysBefore(today, 6) };
  }
  if (query.period === 'week') {
    const from = daysBefore(today, 6);
    return { from, to: today, chartFrom: from };
  }
  if (query.period === 'month') {
    const from = `${today.slice(0, 8)}01`;
    return { from, to: today, chartFrom: from };
  }
  const { from, to } = query;
  if (!from || !to) {
    throw new ApiError(400, 'validation_failed', correlationId, [
      { field: from ? 'to' : 'from', code: 'required' },
    ]);
  }
  if (from > to || to > today || daysBetween(from, to) >= 92) {
    throw new ApiError(422, 'validation_failed', correlationId, [
      { field: 'from', code: 'range' },
    ]);
  }
  return { from, to, chartFrom: from };
}

function dashboard(
  query: DashboardQuery,
  session: EmployeeSession,
  correlationId: string,
): TenantDashboard {
  const { from, to, chartFrom } = periodDates(query, correlationId);
  const days = daysBetween(from, to) + 1;
  const storeIds = session.stores.map((store) => store.id);
  const rows = stores
    .filter((store) => storeIds.includes(store.id))
    .map((store) => ({
      storeId: store.id,
      name: store.name,
      mode: store.mode,
      lastSyncAt:
        store.mode === 'offline'
          ? new Date(Date.now() - 52 * 60_000).toISOString()
          : null,
      receipts: storeDay[store.id].receipts * days,
      revenueMinor: storeDay[store.id].revenueMinor * days,
    }));
  const receipts = rows.reduce((sum, row) => sum + row.receipts, 0);
  const revenueMinor = rows.reduce((sum, row) => sum + row.revenueMinor, 0);
  const dayRevenue = revenueMinor / days;
  const shape = [0.82, 0.95, 0.88, 1.06, 1.12, 0.74, 1];
  const chartDays = daysBetween(chartFrom, to) + 1;
  const visible = notificationsOf(session);
  const storeNames = session.stores.map((store) => store.name);
  return {
    period: query.period,
    from,
    to,
    kpi: {
      revenueMinor,
      revenueChangePercent: rows.length ? 12 : null,
      receipts,
      averageReceiptMinor: receipts ? Math.round(revenueMinor / receipts) : 0,
      lowStockItems: rows.length ? 27 : 0,
      expiringBatches: rows.length ? 14 : 0,
      expiringCritical: rows.length ? 3 : 0,
    },
    stores: rows,
    revenueByDay: Array.from({ length: chartDays }, (_, index) => ({
      date: daysBefore(to, chartDays - 1 - index),
      revenueMinor: Math.round(
        dayRevenue * shape[(shape.length - chartDays + index + 70) % 7],
      ),
    })),
    reminders: [...visible]
      .sort((x, y) => Number(x.read) - Number(y.read))
      .slice(0, 5)
      .map(({ id, kind, params }) => ({ id, kind, params })),
    recentActivity: mockDb()
      .owner.audit.filter(
        (a) =>
          a.action !== 'sign_in' &&
          a.action !== 'access_denied' &&
          (a.storeName === null
            ? session.scope === 'network'
            : storeNames.includes(a.storeName)),
      )
      .slice(0, 8),
  };
}

function toMe(employee: MockEmployeeState): EmployeeMe {
  return {
    id: employee.id,
    fullName: employee.fullName,
    login: employee.login,
    phone: employee.phone,
    roleName:
      mockDb().owner.roles.find((r) => r.id === employee.roleId)?.name ?? '—',
    scope: employee.storeIds === null ? 'network' : 'stores',
    storeNames: employeeStores(employee).map((store) => store.name),
    lastLoginAt: employee.lastLoginAt,
    locale: employee.locale,
    pinSet: employee.pin !== null,
  };
}

const handlers: MockHandlers = {
  ...posHandlers,
  ...stockHandlers,
  ...purchasingHandlers,
  ...catalogHandlers,
  ...staffHandlers,
  ...ownerHandlers,
  'sessions.create': ({ body, correlationId }) => {
    const employee = mockDb().employees.find(
      (e) => e.login === body.login.trim().toLowerCase(),
    );
    // unknown login and wrong password are indistinguishable (ADR-0008)
    if (!employee || employee.password !== body.password) {
      throw new ApiError(401, 'invalid_credentials', correlationId);
    }
    if (employee.status === 'blocked') {
      throw new ApiError(403, 'employee_blocked', correlationId);
    }
    return toSession(
      startSession(employee, 'password', null, null),
      correlationId,
    ).session;
  },
  'sessions.current': ({ correlationId }) => current(correlationId).session,
  'sessions.selectStore': ({ body, correlationId }) => {
    const { stored, session } = current(correlationId);
    if (
      stored.auth === 'pin' ||
      !session.stores.some((store) => store.id === body.storeId)
    ) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    const next = { ...stored, currentStoreId: body.storeId };
    writeSession(next);
    return toSession(next, correlationId).session;
  },
  'sessions.delete': () => {
    writeSession(null);
  },
  // Password re-confirmation (ADR-0008, amendment 2026-10-06); the mocks have no session age.
  'sessions.confirm': ({ body, correlationId }) => {
    const { employee, stored } = current(correlationId);
    if (stored.auth !== 'password') {
      throw new ApiError(403, 'password_session_required', correlationId);
    }
    if (employee.password !== body.password) {
      throw new ApiError(422, 'invalid_current_password', correlationId, [
        { field: 'password', code: 'invalid_current_password' },
      ]);
    }
  },
  // First sign-in by a one-time code (synthetic code of the demo data; ADR-0008).
  'activations.create': ({ body, correlationId }) => {
    const code = body.code.replace(/[\s-]/g, '').toUpperCase();
    const known = mockDb().employees.some(
      (e) => e.login === body.login.trim().toLowerCase(),
    );
    if (!known || code !== MOCK_ACTIVATION_CODE) {
      throw new ApiError(401, 'invalid_code', correlationId);
    }
    if (passwordProblems(body.newPassword).length > 0) {
      throw new ApiError(422, 'password_policy', correlationId);
    }
  },

  'terminals.current': ({ correlationId }) => {
    const db = mockDb();
    const terminal = db.terminal;
    if (!terminal) throw new ApiError(404, 'not_bound', correlationId);
    const store = stores.find((s) => s.id === terminal.storeId);
    if (!store) throw new ApiError(404, 'not_bound', correlationId);
    return {
      id: terminal.id,
      tenantId: tenant.id,
      name: terminal.name,
      store,
      cashiers: db.employees
        .filter(
          (e) =>
            e.pin !== null &&
            e.status === 'active' &&
            e.storeIds?.includes(store.id),
        )
        .map((e) => ({ employeeId: e.id, shortName: e.shortName })),
      pinLength: 4,
    };
  },
  'terminals.unbind': ({ params, correlationId }) => {
    const { session, stored } = authorize(correlationId, 'terminals:delete', {
      write: true,
    });
    if (stored.auth !== 'password') {
      throw new ApiError(403, 'fresh_auth_required', correlationId);
    }
    const db = mockDb();
    const tenantTerminal = db.owner.terminals.find((t) => t.id === params.id);
    if (
      tenantTerminal &&
      !session.stores.some((s) => s.id === tenantTerminal.storeId)
    ) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    db.owner.terminals = db.owner.terminals.filter((t) => t.id !== params.id);
    for (const employeeId of Object.keys(db.terminals)) {
      db.terminals[employeeId] = db.terminals[employeeId].filter(
        (terminal) => terminal.id !== params.id,
      );
    }
    if (db.terminal?.id === params.id) db.terminal = null;
  },
  'terminalSessions.create': ({ body, correlationId }) => {
    const db = mockDb();
    if (!db.terminal) throw new ApiError(404, 'not_bound', correlationId);
    const employee = db.employees.find((e) => e.id === body.employeeId);
    if (!employee || !employee.storeIds?.includes(db.terminal.storeId)) {
      throw new ApiError(401, 'invalid_pin', correlationId);
    }
    if (employee.status === 'blocked') {
      throw new ApiError(403, 'employee_blocked', correlationId);
    }
    if (employee.pinLocked) {
      throw new ApiError(423, 'pin_locked', correlationId);
    }
    if (employee.pin !== body.pin) {
      employee.pinFailures += 1;
      if (employee.pinFailures >= PIN_MAX_FAILURES) {
        employee.pinLocked = true;
        throw new ApiError(423, 'pin_locked', correlationId);
      }
      throw new ApiError(401, 'invalid_pin', correlationId);
    }
    employee.pinFailures = 0;
    return toSession(
      startSession(employee, 'pin', db.terminal.storeId, db.terminal.id),
      correlationId,
    ).session;
  },

  'sync.status': ({ correlationId }) => {
    const { session } = current(correlationId);
    const store = stores.find((s) => s.id === session.currentStoreId);
    if (store?.mode !== 'offline') {
      throw new ApiError(404, 'not_found', correlationId);
    }
    return {
      lastSyncAt: new Date(Date.now() - 52 * 60_000).toISOString(),
      pendingOperations: 3,
      licenseValidUntil: new Date(Date.now() + 9 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    };
  },

  'dashboard.get': ({ query, correlationId }) => {
    const { session } = authorize(correlationId, 'reports:view');
    return dashboard(query, session, correlationId);
  },

  'notifications.list': ({ query, correlationId }) => {
    const { session } = authorize(correlationId, 'notifications:view');
    const items = notificationsOf(session);
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      unread: items.filter((item) => !item.read).length,
    };
  },
  'navCounters.get': ({ query, correlationId }) => {
    const { session } = authorize(correlationId, null);
    if (query?.storeId) inScope(session, query.storeId, correlationId);
    const storeIds = query?.storeId
      ? [query.storeId]
      : session.stores.map((s) => s.id);
    const has = (permission: Permission) =>
      hasPermissions(session.permissions, permission);
    return {
      ...(has('inventory:view') && {
        lowStock: reorderLines(storeIds).length,
      }),
      ...(has('inventory:receive') && {
        incomingTransfers: incomingTransfers(storeIds),
      }),
      ...(has('pricing:view') && {
        priceProblems: priceProblems(
          session,
          has('finance:view-cost'),
          storeIds,
        ).length,
      }),
    };
  },

  // the announcements of the platform on now (spec 2026-10-19-operator-notifications, N14)
  'announcements.list': () => [],

  'notifications.readAll': ({ correlationId }) => {
    const { session } = authorize(correlationId, 'notifications:view');
    const visible = new Set(notificationsOf(session).map((n) => n.id));
    for (const item of mockDb().notifications) {
      if (visible.has(item.id) && !item.readBy.includes(session.employee.id)) {
        item.readBy.push(session.employee.id);
      }
    }
  },

  'me.get': ({ correlationId }) => toMe(current(correlationId).employee),
  'me.update': ({ body, correlationId }) => {
    const { employee } = authorize(correlationId, null, { write: true });
    employee.locale = body.locale;
    return toMe(employee);
  },
  'me.changePassword': ({ body, correlationId }) => {
    const { employee, stored } = authorize(correlationId, null, {
      write: true,
    });
    if (stored.auth !== 'password') {
      throw new ApiError(403, 'fresh_auth_required', correlationId);
    }
    if (employee.password !== body.currentPassword) {
      throw new ApiError(422, 'invalid_current_password', correlationId, [
        { field: 'currentPassword', code: 'invalid_current_password' },
      ]);
    }
    employee.password = body.newPassword;
  },
  'me.changePin': ({ body, correlationId }) => {
    const { employee, stored } = authorize(correlationId, null, {
      write: true,
    });
    if (stored.auth !== 'password') {
      throw new ApiError(403, 'fresh_auth_required', correlationId);
    }
    if (employee.pin !== null && employee.pin !== body.currentPin) {
      throw new ApiError(422, 'invalid_current_pin', correlationId, [
        { field: 'currentPin', code: 'invalid_current_pin' },
      ]);
    }
    if (
      checkPin(body.newPin, mockDb().owner.settings.minPinLength) === 'length'
    ) {
      throw new ApiError(422, 'pin_length', correlationId, [
        { field: 'newPin', code: 'pin_length' },
      ]);
    }
    if (isTrivialPin(body.newPin)) {
      throw new ApiError(422, 'pin_trivial', correlationId, [
        { field: 'newPin', code: 'pin_trivial' },
      ]);
    }
    employee.pin = body.newPin;
    employee.pinFailures = 0;
    employee.pinLocked = false;
  },
  'me.terminals': ({ correlationId }) => {
    const { session } = current(correlationId);
    return mockDb().terminals[session.employee.id] ?? [];
  },
};

export const mockTransport: ApiTransport = async (
  route,
  options,
  correlationId,
) => {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (options.signal?.aborted) throw new ApiError(0, 'aborted', correlationId);
  // outage: the mock flag, or the «Offline» checkbox of the browser devtools in development
  if (mockDb().pos.offline || navigator.onLine === false) {
    throw new ApiError(0, 'network', correlationId);
  }
  const handler = handlers[route] as (
    request: MockRequest<typeof route>,
  ) => ApiResponse<typeof route>;
  // copy: callers must not mutate the mock database through responses
  const result = handler({
    params: options.params as ApiParams<typeof route>,
    query: options.query as ApiQuery<typeof route>,
    body: options.body as ApiBody<typeof route>,
    correlationId,
    idempotencyKey: options.idempotencyKey,
  });
  return result === undefined
    ? result
    : (JSON.parse(JSON.stringify(result)) as typeof result);
};

/** Dev and tests only: forget the device-cookie (an unbound browser). */
export function unbindMockTerminal(): void {
  mockDb().terminal = null;
}

/** Dev and tests: put the mocks into a state that is hard to reach by clicking. */
export function applyScenario(
  scenario:
    'unbound-terminal' | 'offline' | 'online' | 'no-shift' | 'offline-store',
): void {
  switch (scenario) {
    case 'offline-store':
      mockDb().owner.deployment = 'offline-store';
      break;
    case 'unbound-terminal':
      unbindMockTerminal();
      break;
    case 'offline':
      mockDb().pos.offline = true;
      break;
    case 'online':
      mockDb().pos.offline = false;
      break;
    case 'no-shift':
      for (const shift of mockDb().pos.shifts) shift.status = 'closed';
      break;
  }
}
