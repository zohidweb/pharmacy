/*
 * Mock handlers of employees, roles, terminals and the audit log — the rules apps/api will enforce
 * (ADR-0018): no escalation of permissions or scope, one's own role and scope stay as they are,
 * «Владелец» is a system role and the network keeps an active owner, blocking ends the sessions;
 * passwords and PINs follow ADR-0008 and never come back in responses. The audit log is read only.
 */
import {
  auditGroupOf,
  checkPin,
  exceedingPermissions,
  isPermission,
  passwordProblems,
  scopeWithin,
} from '@pharmacy/shared-domain';
import type {
  CreateEmployeeRequest,
  EmployeeCard,
  EmployeeListItem,
  EmployeeSession,
  Role,
  RoleInput,
  TenantAuditEntry,
  UpdateEmployeeRequest,
} from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb, type MockEmployeeState } from './db';
import type { MockRole } from './db-owner';
import { stores } from './fixtures';
import { context, findDoc, page } from './handlers-stock';
import { authorize } from './session';
import type { MockHandlers } from './types';

type StaffRoute = Extract<
  ApiRouteKey,
  `employees.${string}` | `roles.${string}` | 'terminals.list' | 'auditLog.list'
>;

const owner = () => mockDb().owner;

const validation = (correlationId: string, field: string, code: string) =>
  new ApiError(400, 'validation_failed', correlationId, [{ field, code }]);
const conflict = (correlationId: string, field: string, code: string) =>
  new ApiError(409, code, correlationId, [{ field, code }]);

/** Store ids of the session scope; null — the whole network. */
const scopeOf = (session: EmployeeSession) =>
  session.scope === 'network' ? null : session.stores.map((s) => s.id);

const roleOf = (roleId: string) =>
  owner().roles.find((r) => r.id === roleId) ?? null;

function employeeItem(e: MockEmployeeState): EmployeeListItem {
  return {
    id: e.id,
    fullName: e.fullName,
    login: e.login,
    phone: e.phone,
    roleId: e.roleId,
    roleName: roleOf(e.roleId)?.name ?? '—',
    storeIds: e.storeIds,
    storeNames:
      e.storeIds === null
        ? []
        : stores.filter((s) => e.storeIds?.includes(s.id)).map((s) => s.name),
    locale: e.locale,
    status: e.status,
    pinSet: e.pin !== null,
    pinLocked: e.pinLocked,
    lastLoginAt: e.lastLoginAt,
  };
}

function employeeCard(e: MockEmployeeState): EmployeeCard {
  return {
    ...employeeItem(e),
    activity: owner()
      .audit.filter((a) => a.employeeName === e.fullName)
      .slice(0, 10)
      .flatMap(({ at, action, object }) =>
        action === null
          ? []
          : [{ at, action, object: object ?? '—', details: '—' }],
      ),
  };
}

/** Employees the editor may see and manage: inside the editor's scope (ADR-0018, п. 3). */
function visibleTo(session: EmployeeSession, e: MockEmployeeState) {
  const scope = scopeOf(session);
  return (
    scope === null || (e.storeIds?.some((id) => scope.includes(id)) ?? false)
  );
}

function employeeOf(
  session: EmployeeSession,
  id: string,
  correlationId: string,
) {
  const employee = findDoc(mockDb().employees, id, correlationId);
  if (!visibleTo(session, employee)) {
    throw new ApiError(403, 'store_not_in_scope', correlationId);
  }
  return employee;
}

/**
 * Another employee may be changed only when not above the editor — role and stores (ADR-0018,
 * п. 4): a password reset would otherwise hand over a stronger account or other stores. A peer —
 * the same permissions and stores — only with `employees:manage-peers`, which no role template
 * holds (ADR-0018, amendment 2026-10-13).
 */
function editableOf(
  session: EmployeeSession,
  id: string,
  correlationId: string,
) {
  const employee = employeeOf(session, id, correlationId);
  if (employee.id === session.employee.id) return employee;
  const role = roleOf(employee.roleId);
  if (
    !role ||
    (role.system && !session.role.system) ||
    exceedingPermissions(session.permissions, role.permissions).length > 0
  ) {
    throw new ApiError(403, 'permission_escalation', correlationId);
  }
  const own = scopeOf(session);
  if (!scopeWithin(own, employee.storeIds)) {
    throw new ApiError(403, 'store_not_in_scope', correlationId);
  }
  const stores = employee.storeIds;
  const sameStores =
    own === null || stores === null
      ? own === stores
      : own.length === stores.length && stores.every((s) => own.includes(s));
  if (
    !session.permissions.includes('employees:manage-peers') &&
    exceedingPermissions(role.permissions, session.permissions).length === 0 &&
    sameStores
  ) {
    throw new ApiError(403, 'forbidden', correlationId);
  }
  return employee;
}

/**
 * As `editableOf`, and not oneself: one's own password, PIN and status are changed in the profile.
 */
function othersEditableOf(
  session: EmployeeSession,
  id: string,
  correlationId: string,
) {
  const employee = editableOf(session, id, correlationId);
  if (employee.id === session.employee.id) {
    throw new ApiError(403, 'own_assignment', correlationId);
  }
  return employee;
}

/** An entry of the journal as the API writes it: the code of the event, its object and values. */
export function appendAudit(
  session: EmployeeSession,
  entry: Pick<TenantAuditEntry, 'event' | 'object'> & {
    params?: TenantAuditEntry['params'];
    storeName?: string | null;
  },
) {
  const params = entry.params ?? {};
  owner().audit.unshift({
    id: `au-${owner().counters.audit++}`,
    at: new Date().toISOString(),
    documentDate: null,
    employeeName: session.employee.fullName,
    storeName:
      entry.storeName ??
      session.stores.find((s) => s.id === session.currentStoreId)?.name ??
      null,
    action: auditGroupOf(entry.event, params),
    event: entry.event,
    object: entry.object,
    params,
    byOperator: session.impersonation !== null,
  });
}

/** The assignment rules of ADR-0018, п. 4: role ⊆ editor, scope ⊆ editor, owner only by owner. */
function checkAssignment(
  session: EmployeeSession,
  body: Pick<UpdateEmployeeRequest, 'roleId' | 'storeIds'>,
  correlationId: string,
): MockRole {
  const role = roleOf(body.roleId);
  if (!role) throw validation(correlationId, 'roleId', 'required');
  if (exceedingPermissions(session.permissions, role.permissions).length > 0) {
    throw new ApiError(403, 'permission_escalation', correlationId);
  }
  if (role.system && !session.role.system) {
    throw new ApiError(403, 'permission_escalation', correlationId);
  }
  const storeIds = role.system ? null : body.storeIds;
  if (storeIds !== null && storeIds.length === 0) {
    throw validation(correlationId, 'storeIds', 'required');
  }
  if (!scopeWithin(scopeOf(session), storeIds)) {
    throw new ApiError(403, 'store_not_in_scope', correlationId);
  }
  return role;
}

const activeOwners = () =>
  mockDb().employees.filter(
    (e) => e.status === 'active' && roleOf(e.roleId)?.system,
  );

function roleInput(body: RoleInput, correlationId: string, exceptId?: string) {
  const name = body.name.trim();
  if (!name) throw validation(correlationId, 'name', 'required');
  if (
    owner().roles.some(
      (r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw validation(correlationId, 'name', 'taken');
  }
  if (!body.permissions.every(isPermission)) {
    throw validation(correlationId, 'permissions', 'unknown');
  }
  return { name, permissions: [...new Set(body.permissions)] };
}

function toRole(role: MockRole): Role {
  return {
    ...role,
    employees: mockDb().employees.filter((e) => e.roleId === role.id).length,
  };
}

export const staffHandlers: Pick<MockHandlers, StaffRoute> = {
  'employees.list': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'employees:view');
    const items = mockDb()
      .employees.filter((e) => visibleTo(session, e))
      .filter(
        (e) =>
          !query?.storeId ||
          e.storeIds === null ||
          e.storeIds.includes(query.storeId),
      )
      .filter((e) => !query?.roleId || e.roleId === query.roleId)
      .filter((e) => !query?.status || e.status === query.status)
      .map(employeeItem);
    return page(items, { limit: query?.limit ?? 20, offset: query?.offset });
  },
  'employees.get': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'employees:view');
    return employeeCard(employeeOf(session, params.id, correlationId));
  },
  'employees.create': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'employees:create', {
      write: true,
    });
    authorize(correlationId, 'employees:assign-role');
    const input = employeeInput(body, correlationId);
    if (passwordProblems(body.password).length > 0) {
      throw validation(correlationId, 'password', 'policy');
    }
    if (
      body.pin &&
      checkPin(body.pin, owner().settings.minPinLength) !== null
    ) {
      throw validation(correlationId, 'pin', 'policy');
    }
    const role = checkAssignment(session, body, correlationId);
    const employee: MockEmployeeState = {
      id: `emp-new-${owner().counters.employee++}`,
      ...input,
      shortName: shortName(input.fullName),
      roleId: role.id,
      role: role.templateKey ?? 'cashier',
      storeIds: role.system ? null : body.storeIds,
      pin: body.pin || null,
      password: body.password,
      pinFailures: 0,
      pinLocked: false,
      lastLoginAt: null,
      status: 'active',
    };
    mockDb().employees.push(employee);
    appendAudit(session, {
      event: 'employee.created',
      object: employee.fullName,
    });
    return employeeCard(employee);
  },
  'employees.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'employees:update', {
      write: true,
    });
    const employee = editableOf(session, params.id, correlationId);
    const input = employeeInput(body, correlationId, employee.id);
    const sameStores =
      JSON.stringify(employee.storeIds) === JSON.stringify(body.storeIds);
    const assignmentChanged = employee.roleId !== body.roleId || !sameStores;
    if (assignmentChanged) {
      if (employee.id === session.employee.id) {
        throw new ApiError(403, 'own_assignment', correlationId);
      }
      authorize(correlationId, 'employees:assign-role');
      const role = checkAssignment(session, body, correlationId);
      if (
        roleOf(employee.roleId)?.system &&
        !role.system &&
        activeOwners().length === 1 &&
        employee.status === 'active'
      ) {
        throw new ApiError(409, 'last_owner', correlationId);
      }
      employee.roleId = role.id;
      employee.storeIds = role.system ? null : body.storeIds;
      appendAudit(session, {
        event: 'employee.assignment-changed',
        object: employee.fullName,
      });
    }
    Object.assign(employee, input, { shortName: shortName(input.fullName) });
    return employeeCard(employee);
  },
  'employees.resetPassword': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'employees:update', {
      write: true,
    });
    const employee = othersEditableOf(session, params.id, correlationId);
    if (passwordProblems(body.newPassword).length > 0) {
      throw validation(correlationId, 'newPassword', 'policy');
    }
    employee.password = body.newPassword;
    appendAudit(session, {
      event: 'employee.password-reset',
      object: employee.fullName,
    });
  },
  'employees.setPin': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'employees:update', {
      write: true,
    });
    const employee = othersEditableOf(session, params.id, correlationId);
    const problem = checkPin(body.pin, owner().settings.minPinLength);
    if (problem !== null) {
      const code = problem === 'trivial' ? 'pin_trivial' : 'pin_length';
      throw new ApiError(422, code, correlationId, [{ field: 'pin', code }]);
    }
    employee.pin = body.pin;
    employee.pinFailures = 0;
    employee.pinLocked = false;
    appendAudit(session, {
      event: 'employee.pin-set',
      object: employee.fullName,
    });
  },
  'employees.setStatus': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'employees:update', {
      write: true,
    });
    const employee = othersEditableOf(session, params.id, correlationId);
    if (
      body.status === 'blocked' &&
      roleOf(employee.roleId)?.system &&
      activeOwners().length === 1
    ) {
      throw new ApiError(409, 'last_owner', correlationId);
    }
    if (employee.status !== body.status) {
      appendAudit(session, {
        event:
          body.status === 'blocked' ? 'employee.blocked' : 'employee.unblocked',
        object: employee.fullName,
      });
    }
    employee.status = body.status;
    return employeeCard(employee);
  },

  'roles.list': ({ correlationId }) => {
    context(correlationId, 'roles:view');
    return owner().roles.map(toRole);
  },
  'roles.create': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'roles:manage', {
      write: true,
    });
    const input = roleInput(body, correlationId);
    if (exceedingPermissions(session.permissions, input.permissions).length) {
      throw new ApiError(403, 'permission_escalation', correlationId);
    }
    const role: MockRole = {
      id: `role-custom-${owner().counters.role++}`,
      ...input,
      system: false,
      templateKey: null,
    };
    owner().roles.push(role);
    appendAudit(session, {
      event: 'role.created',
      object: role.name,
    });
    return toRole(role);
  },
  'roles.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'roles:manage', {
      write: true,
    });
    const role = findDoc(owner().roles, params.id, correlationId);
    if (role.system) throw new ApiError(409, 'system_role', correlationId);
    if (session.role.id === role.id) {
      throw new ApiError(403, 'own_assignment', correlationId);
    }
    const input = roleInput(body, correlationId, role.id);
    if (exceedingPermissions(session.permissions, input.permissions).length) {
      throw new ApiError(403, 'permission_escalation', correlationId);
    }
    Object.assign(role, input);
    appendAudit(session, {
      event: 'role.updated',
      object: role.name,
    });
    return toRole(role);
  },

  'terminals.list': ({ correlationId }) => {
    const { session } = context(correlationId, 'terminals:view');
    return owner().terminals.filter((t) =>
      session.stores.some((s) => s.id === t.storeId),
    );
  },

  'auditLog.list': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'audit:view');
    const storeNames = session.stores.map((s) => s.name);
    const needle = (query?.q ?? '').trim().toLocaleLowerCase('ru');
    const employee = query?.employeeId
      ? mockDb().employees.find((e) => e.id === query.employeeId)
      : null;
    const store = query?.storeId
      ? stores.find((s) => s.id === query.storeId)
      : null;
    const items = owner()
      .audit.filter((a) =>
        a.storeName === null
          ? session.scope === 'network'
          : storeNames.includes(a.storeName),
      )
      .filter((a) => !query?.from || a.at.slice(0, 10) >= query.from)
      .filter((a) => !query?.to || toAppDate(new Date(a.at)) <= query.to)
      .filter((a) => !employee || a.employeeName === employee.fullName)
      .filter((a) => !store || a.storeName === store.name)
      .filter((a) => !query?.action || a.action === query.action)
      .filter(
        (a) =>
          !needle ||
          `${a.object ?? ''}`.toLocaleLowerCase('ru').includes(needle),
      );
    return page(items, { limit: query?.limit ?? 20, offset: query?.offset });
  },
};

function employeeInput(
  body: UpdateEmployeeRequest | CreateEmployeeRequest,
  correlationId: string,
  exceptId?: string,
) {
  const fullName = body.fullName.trim();
  const login = body.login.trim().toLowerCase();
  if (!fullName) throw validation(correlationId, 'fullName', 'required');
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
    throw validation(correlationId, 'login', 'format');
  }
  if (mockDb().employees.some((e) => e.id !== exceptId && e.login === login)) {
    throw conflict(correlationId, 'login', 'login_taken');
  }
  const phone = body.phone.replace(/[\s()-]/g, '');
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    throw validation(correlationId, 'phone', 'phone_format');
  }
  if (
    mockDb().employees.some(
      (e) => e.id !== exceptId && e.phone.replace(/[\s()-]/g, '') === phone,
    )
  ) {
    throw conflict(correlationId, 'phone', 'phone_taken');
  }
  return {
    fullName,
    login,
    phone: body.phone.trim(),
    locale: body.locale,
  };
}

/** «Зарина Рахимова» → «Зарина Р.» for documents and the audit log. */
function shortName(fullName: string) {
  const [first, last] = fullName.split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}
