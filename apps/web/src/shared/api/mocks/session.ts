/* Mock session (sessionStorage) and the server-side guard rules the handlers share. */
import { hasPermissions, type Permission } from '@pharmacy/shared-domain';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import { ApiError } from '../client';
import { mockDb, type MockEmployeeState } from './db';
import { stores, tenant } from './fixtures';

const SESSION_KEY = 'pharmacy-web-mock-session';

export interface StoredSession {
  employeeId: string;
  currentStoreId: string | null;
  auth: 'password' | 'pin';
  terminalId: string | null;
  authenticatedAt: string;
  impersonation: EmployeeSession['impersonation'];
}

export function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): the mock session lives only until reload
  }
}

export function employeeStores(employee: MockEmployeeState) {
  return employee.storeIds === null
    ? stores
    : stores.filter((store) => employee.storeIds?.includes(store.id));
}

export function toSession(stored: StoredSession, correlationId: string) {
  const employee = mockDb().employees.find((e) => e.id === stored.employeeId);
  // a blocked employee loses the sessions at once (ADR-0018, п. 7)
  if (!employee || employee.status === 'blocked') {
    throw new ApiError(401, 'unauthenticated', correlationId);
  }
  const role = mockDb().owner.roles.find((r) => r.id === employee.roleId);
  if (!role) throw new ApiError(401, 'unauthenticated', correlationId);
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
      id: role.id,
      name: role.name,
      system: role.system,
      templateKey: role.templateKey,
    },
    permissions: [...role.permissions],
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

// In the `partial` mode the real session lives in apps/api, which the mocks cannot see: the mocked
// screens answer for the demo owner at the first demo store instead of 401, which would send the
// app back to sign-in in a loop (plan 2026-10-06-owner-stores, task 4).
function demoSession(): StoredSession | null {
  if (process.env.NEXT_PUBLIC_API_MOCKS !== 'partial') return null;
  const owner = mockDb().employees.find((e) => e.login === 'firuz');
  if (!owner) return null;
  return {
    employeeId: owner.id,
    currentStoreId: stores[0]?.id ?? null,
    auth: 'password',
    terminalId: null,
    authenticatedAt: new Date().toISOString(),
    impersonation: null,
  };
}

export function current(correlationId: string) {
  const stored = readSession() ?? demoSession();
  if (!stored) throw new ApiError(401, 'unauthenticated', correlationId);
  return { stored, ...toSession(stored, correlationId) };
}

/** Like the server guard: permission of the role, then the view-only rule of impersonation. */
export function authorize(
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

export function startSession(
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
