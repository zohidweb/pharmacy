/*
 * In-memory mock transport: answers the same routes and errors (problem codes) as apps/api will,
 * so screens are built against the real contract — including the rules the server enforces:
 * permissions and store scope (ADR-0018), PIN only on a bound terminal and PIN lock after three
 * failures (ADR-0008), view-only impersonation. The mock session lives in sessionStorage to survive
 * a reload in development. Enabled only by NEXT_PUBLIC_API_MOCKS=true.
 */
import { checkPin, isTrivialPin, passwordProblems } from '@pharmacy/shared-domain';
import type {
  DashboardPeriod,
  EmployeeMe,
  TenantDashboard,
} from '@pharmacy/shared-dto';
import { ApiError, type ApiTransport } from '../client';
import type { ApiBody, ApiParams, ApiQuery, ApiResponse } from '../routes';
import { mockDb, type MockEmployeeState } from './db';
import { storeDay, stores } from './fixtures';
import {
  authorize,
  current,
  employeeStores,
  startSession,
  toSession,
  writeSession,
} from './session';
import { catalogHandlers } from './handlers-catalog';
import { ownerHandlers } from './handlers-owner';
import { posHandlers } from './handlers-pos';
import { purchasingHandlers } from './handlers-purchasing';
import { staffHandlers } from './handlers-staff';
import { stockHandlers } from './handlers-stock';
import type { MockHandlers, MockRequest } from './types';

/** Simulated network latency in development; none in tests (fast, deterministic). */
const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 300;
const PIN_MAX_FAILURES = 3;
/** The one-time activation code the mocks accept for any demo login. */
export const MOCK_ACTIVATION_CODE = 'DEMOACTIVATIONCODE00000000';

const PERIOD_DAYS: Record<DashboardPeriod, number> = {
  today: 1,
  week: 7,
  month: 30,
};

function dashboard(
  period: DashboardPeriod,
  storeIds: string[],
): TenantDashboard {
  const days = PERIOD_DAYS[period];
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
  const today = Date.now();
  const db = mockDb();
  return {
    period,
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
    revenueByDay: shape.map((factor, index) => ({
      date: new Date(today - (6 - index) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      revenueMinor: Math.round(dayRevenue * factor),
    })),
    reminders: db.notifications
      .filter((n) => n.kind !== 'low_stock')
      .slice(0, 3)
      .map(({ id, kind, params }) => ({ id, kind, params })),
    recentActivity: db.activity,
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
      throw new ApiError(403, 'step_up_required', correlationId);
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
    return dashboard(
      query.period,
      session.stores.map((store) => store.id),
    );
  },

  'notifications.list': ({ query, correlationId }) => {
    current(correlationId);
    const items = mockDb().notifications;
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
  'notifications.readAll': ({ correlationId }) => {
    current(correlationId);
    for (const item of mockDb().notifications) item.read = true;
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
      throw new ApiError(403, 'step_up_required', correlationId);
    }
    if (employee.password !== body.currentPassword) {
      throw new ApiError(422, 'wrong_password', correlationId, [
        { field: 'currentPassword', code: 'wrong' },
      ]);
    }
    employee.password = body.newPassword;
  },
  'me.changePin': ({ body, correlationId }) => {
    const { employee, stored } = authorize(correlationId, null, {
      write: true,
    });
    if (stored.auth !== 'password') {
      throw new ApiError(403, 'step_up_required', correlationId);
    }
    if (employee.pin !== null && employee.pin !== body.currentPin) {
      throw new ApiError(422, 'wrong_pin', correlationId, [
        { field: 'currentPin', code: 'wrong' },
      ]);
    }
    if (
      checkPin(body.newPin, mockDb().owner.settings.minPinLength) === 'length'
    ) {
      throw new ApiError(422, 'validation_failed', correlationId, [
        { field: 'newPin', code: 'length' },
      ]);
    }
    if (isTrivialPin(body.newPin)) {
      throw new ApiError(422, 'pin_trivial', correlationId, [
        { field: 'newPin', code: 'trivial' },
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

/** Dev and tests only: start a view-only «от имени» session as the owner (ADR-0008). */
export function startMockImpersonation(operatorName: string): void {
  const owner = mockDb().employees.find((e) => e.role === 'owner');
  if (!owner) return;
  const stored = startSession(owner, 'password', stores[0].id, null);
  writeSession({
    ...stored,
    impersonation: { operatorName, startedAt: new Date().toISOString() },
  });
}

/** Dev and tests only: forget the device-cookie (an unbound browser). */
export function unbindMockTerminal(): void {
  mockDb().terminal = null;
}

/** Dev and tests: put the mocks into a state that is hard to reach by clicking. */
export function applyScenario(
  scenario:
    | 'impersonation'
    | 'unbound-terminal'
    | 'offline'
    | 'online'
    | 'no-shift'
    | 'offline-store',
): void {
  switch (scenario) {
    case 'offline-store':
      mockDb().owner.deployment = 'offline-store';
      break;
    case 'impersonation':
      startMockImpersonation('Оператор платформы');
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
