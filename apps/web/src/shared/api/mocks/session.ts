/* Mock session (sessionStorage) and the server-side guard rules the handlers share. */
import {
  hasPermissions,
  roleTemplates,
  type Permission,
} from '@pharmacy/shared-domain';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import { ApiError } from '../client';
import { mockDb, type MockEmployeeState } from './db';
import { roleNames, stores, tenant } from './fixtures';

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

export function current(correlationId: string) {
  const stored = readSession();
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
