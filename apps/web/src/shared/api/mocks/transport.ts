/*
 * In-memory mock transport: answers the same routes and errors (problem codes) as apps/api will,
 * so screens are built against the real contract — including the rules the server enforces:
 * permissions and store scope (ADR-0018), PIN only on a bound terminal and PIN lock after three
 * failures (ADR-0008), view-only impersonation. The mock session lives in sessionStorage to survive
 * a reload in development. Enabled only by NEXT_PUBLIC_API_MOCKS=true.
 */
import {
  hasPermissions,
  isTrivialPin,
  roleTemplates,
  type Permission,
} from '@pharmacy/shared-domain';
import type {
  DashboardPeriod,
  EmployeeMe,
  EmployeeSession,
  TenantDashboard,
} from '@pharmacy/shared-dto';
import { ApiError, type ApiTransport } from '../client';
import type { ApiBody, ApiParams, ApiQuery, ApiResponse } from '../routes';
import { mockDb, type MockEmployeeState } from './db';
import { roleNames, storeDay, stores, tenant } from './fixtures';
import type { MockHandlers, MockRequest } from './types';

const SESSION_KEY = 'pharmacy-web-mock-session';
/** Simulated network latency in development; none in tests (fast, deterministic). */
const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 300;
const PIN_MAX_FAILURES = 3;

interface StoredSession {
  employeeId: string;
  currentStoreId: string | null;
  auth: 'password' | 'pin';
  terminalId: string | null;
  authenticatedAt: string;
  impersonation: EmployeeSession['impersonation'];
}

function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): the mock session lives only until reload
  }
}

function employeeStores(employee: MockEmployeeState) {
  return employee.storeIds === null
    ? stores
    : stores.filter((store) => employee.storeIds?.includes(store.id));
}

function toSession(stored: StoredSession, correlationId: string) {
  const employee = mockDb().employees.find((e) => e.id === stored.employeeId);
  if (!employee) throw new ApiError(401, 'unauthenticated', correlationId);
  const template = roleTemplates[employee.role];
  const scoped = employeeStores(employee);
  const session: EmployeeSession = {
    employee: {
      id: employee.id,
      fullName: employee.fullName,
      login: employee.login,
      phone: employee.phone,
    },
    tenant,
    role: {
      id: `role-${employee.role}`,
      name: roleNames[employee.role],
      system: template.system,
      templateKey: employee.role,
    },
    permissions: [...template.permissions],
    scope: employee.storeIds === null ? 'network' : 'stores',
    stores:
      stored.auth === 'pin'
        ? scoped.filter((store) => store.id === stored.currentStoreId)
        : scoped,
    currentStoreId: stored.currentStoreId,
    auth: stored.auth,
    authenticatedAt: stored.authenticatedAt,
    terminalId: stored.terminalId,
    impersonation: stored.impersonation,
    locale: employee.locale,
  };
  return { session, employee };
}

function current(correlationId: string) {
  const stored = readSession();
  if (!stored) throw new ApiError(401, 'unauthenticated', correlationId);
  return { stored, ...toSession(stored, correlationId) };
}

/** Like the server guard: permission of the role, then the view-only rule of impersonation. */
function authorize(
  correlationId: string,
  permission: Permission | null,
  { write = false } = {},
) {
  const context = current(correlationId);
  if (permission && !hasPermissions(context.session.permissions, permission)) {
    throw new ApiError(403, 'forbidden', correlationId);
  }
  if (write && context.session.impersonation) {
    throw new ApiError(403, 'read_only_session', correlationId);
  }
  return context;
}

function startSession(
  employee: MockEmployeeState,
  auth: 'password' | 'pin',
  storeId: string | null,
  terminalId: string | null,
) {
  employee.lastLoginAt = new Date().toISOString();
  const scoped = employeeStores(employee);
  const stored: StoredSession = {
    employeeId: employee.id,
    // one store in the scope needs no choice
    currentStoreId: storeId ?? (scoped.length === 1 ? scoped[0].id : null),
    auth,
    terminalId,
    authenticatedAt: new Date().toISOString(),
    impersonation: null,
  };
  writeSession(stored);
  return stored;
}

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
    roleName: roleNames[employee.role],
    scope: employee.storeIds === null ? 'network' : 'stores',
    storeNames: employeeStores(employee).map((store) => store.name),
    lastLoginAt: employee.lastLoginAt,
    locale: employee.locale,
    pinSet: employee.pin !== null,
  };
}

const handlers: MockHandlers = {
  'sessions.create': ({ body, correlationId }) => {
    const employee = mockDb().employees.find(
      (e) => e.login === body.login.trim().toLowerCase(),
    );
    // unknown login and wrong password are indistinguishable (ADR-0008)
    if (!employee || employee.password !== body.password) {
      throw new ApiError(401, 'invalid_credentials', correlationId);
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
        .filter((e) => e.pin !== null && e.storeIds?.includes(store.id))
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
    db.terminals[session.employee.id] = (
      db.terminals[session.employee.id] ?? []
    ).filter((terminal) => terminal.id !== params.id);
    if (db.terminal?.id === params.id) db.terminal = null;
  },
  'terminalSessions.create': ({ body, correlationId }) => {
    const db = mockDb();
    if (!db.terminal) throw new ApiError(404, 'not_bound', correlationId);
    const employee = db.employees.find((e) => e.id === body.employeeId);
    if (!employee || !employee.storeIds?.includes(db.terminal.storeId)) {
      throw new ApiError(401, 'invalid_pin', correlationId);
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
  if (options.signal?.aborted) throw new ApiError(0, 'network', correlationId);
  const handler = handlers[route] as (
    request: MockRequest<typeof route>,
  ) => ApiResponse<typeof route>;
  // copy: callers must not mutate the mock database through responses
  const result = handler({
    params: options.params as ApiParams<typeof route>,
    query: options.query as ApiQuery<typeof route>,
    body: options.body as ApiBody<typeof route>,
    correlationId,
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
