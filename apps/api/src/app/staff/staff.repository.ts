import { Injectable } from '@nestjs/common';
import type { Permission } from '@pharmacy/shared-domain';
import type { EmployeeStatus } from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import type { Scope } from './assignment-rules';

export interface EmployeeRow {
  id: string;
  fullName: string;
  login: string;
  phone: string | null;
  email: string | null;
  roleId: string;
  roleName: unknown;
  roleIsOwner: boolean;
  storeScope: 'all' | 'list';
  storeIds: string[];
  language: string | null;
  status: string;
  lastLoginAt: Date | null;
  pinSet: boolean;
  pinLocked: boolean;
}

export interface RoleRow {
  id: string;
  name: unknown;
  isOwner: boolean;
  templateKey: string | null;
  permissions: Permission[];
  employees: number;
}

export interface EmployeeFilter {
  storeId?: string;
  roleId?: string;
  status?: EmployeeStatus;
}

export interface NewEmployee {
  id: string;
  roleId: string;
  login: string;
  fullName: string;
  phone: string;
  email: string | null;
  language: 'ru' | 'tj';
  scope: Scope;
}

export interface Hash {
  phc: string;
  pepperVersion: number;
}

export interface ActivityRow {
  recordedAt: Date;
  action: string;
  entityType: string | null;
}

// Data access of employees, roles and terminals (spec 2026-10-06-staff-design). Every query runs
// in a tenant transaction: RLS limits it to the request's network, and tenant_id is still part of
// every filter and composite key (ADR-0002).
@Injectable()
export class StaffRepository {
  private employeeQuery(trx: TenantTransaction, tenantId: string) {
    return trx
      .selectFrom('employees as e')
      .innerJoin('roles as r', (join) =>
        join.onRef('r.tenantId', '=', 'e.tenantId').onRef('r.id', '=', 'e.roleId'),
      )
      .leftJoin('employeeCredentials as c', (join) =>
        join
          .onRef('c.tenantId', '=', 'e.tenantId')
          .onRef('c.employeeId', '=', 'e.id'),
      )
      .select([
        'e.id',
        'e.fullName',
        'e.login',
        'e.phone',
        'e.email',
        'e.roleId',
        'r.name as roleName',
        'r.isOwner as roleIsOwner',
        'e.storeScope',
        'e.language',
        'e.status',
        'e.lastLoginAt',
        sql<boolean>`c.pin_hash is not null`.as('pinSet'),
        sql<boolean>`c.pin_locked_at is not null`.as('pinLocked'),
        sql<string[]>`coalesce((
          select array_agg(es.store_id order by es.store_id)
          from pharmacy.employee_stores es
          where es.tenant_id = e.tenant_id and es.employee_id = e.id
        ), '{}')`.as('storeIds'),
      ])
      .where('e.tenantId', '=', tenantId)
      .where('e.status', '<>', 'archived');
  }

  /** A page of the employees visible to the viewer, by name. */
  async listEmployees(
    trx: TenantTransaction,
    tenantId: string,
    viewer: Scope,
    filter: EmployeeFilter,
    limit: number,
    offset: number,
  ): Promise<{ rows: EmployeeRow[]; total: number }> {
    let query = this.employeeQuery(trx, tenantId);
    if (viewer !== null) {
      query = query
        .where('e.storeScope', '=', 'list')
        .where(sql<boolean>`exists (
          select 1 from pharmacy.employee_stores es
          where es.tenant_id = e.tenant_id and es.employee_id = e.id
            and es.store_id = any(${[...viewer]}::uuid[]))`);
    }
    if (filter.storeId !== undefined) {
      query = query.where(sql<boolean>`(e.store_scope = 'all' or exists (
        select 1 from pharmacy.employee_stores es
        where es.tenant_id = e.tenant_id and es.employee_id = e.id
          and es.store_id = ${filter.storeId}::uuid))`);
    }
    if (filter.roleId !== undefined) query = query.where('e.roleId', '=', filter.roleId);
    if (filter.status !== undefined) query = query.where('e.status', '=', filter.status);
    const [rows, count] = await Promise.all([
      query.orderBy('e.fullName').orderBy('e.id').limit(limit).offset(offset).execute(),
      query
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow(),
    ]);
    return { rows: rows as EmployeeRow[], total: Number(count.total) };
  }

  async findEmployee(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<EmployeeRow | null> {
    const row = await this.employeeQuery(trx, tenantId)
      .where('e.id', '=', id)
      .executeTakeFirst();
    return (row as EmployeeRow | undefined) ?? null;
  }

  /**
   * The last events of the employee in the network's audit log: what the employee did and what
   * concerns the employee (sign-ins are written before a session exists, with the employee as the
   * entity; blocking and password resets by a manager too).
   */
  async activity(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    limit: number,
  ): Promise<ActivityRow[]> {
    return trx
      .selectFrom('auditLog')
      .select(['recordedAt', 'action', 'entityType'])
      .where('tenantId', '=', tenantId)
      .where((eb) =>
        eb.or([
          eb('employeeId', '=', employeeId),
          eb.and([eb('entityType', '=', 'employee'), eb('entityId', '=', employeeId)]),
        ]),
      )
      .orderBy('recordedAt', 'desc')
      .limit(limit)
      .execute();
  }

  /** Names of the network's stores by id. */
  async storeNames(trx: TenantTransaction, tenantId: string): Promise<Map<string, string>> {
    const rows = await trx
      .selectFrom('stores')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .execute();
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** The ids among `ids` that are active stores of the network. */
  async activeStoreIds(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await trx
      .selectFrom('stores')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('status', '=', 'active')
      .where('id', 'in', [...ids])
      .execute();
    return rows.map((row) => row.id);
  }

  async defaultLanguage(trx: TenantTransaction, tenantId: string): Promise<string> {
    const row = await trx
      .selectFrom('tenantSettings')
      .select('defaultLanguage')
      .where('tenantId', '=', tenantId)
      .executeTakeFirst();
    return row?.defaultLanguage ?? 'ru';
  }

  async pinMinLength(trx: TenantTransaction, tenantId: string): Promise<number> {
    const row = await trx
      .selectFrom('tenantSettings')
      .select('pinMinLength')
      .where('tenantId', '=', tenantId)
      .executeTakeFirst();
    return row?.pinMinLength ?? 4;
  }

  /** Active employees with the owner role. */
  async activeOwners(trx: TenantTransaction, tenantId: string): Promise<number> {
    const row = await trx
      .selectFrom('employees as e')
      .innerJoin('roles as r', (join) =>
        join.onRef('r.tenantId', '=', 'e.tenantId').onRef('r.id', '=', 'e.roleId'),
      )
      .select((eb) => eb.fn.countAll<string>().as('owners'))
      .where('e.tenantId', '=', tenantId)
      .where('e.status', '=', 'active')
      .where('r.isOwner', '=', true)
      .executeTakeFirstOrThrow();
    return Number(row.owners);
  }

  async insertEmployee(
    trx: TenantTransaction,
    tenantId: string,
    employee: NewEmployee,
    password: Hash,
    pin: Hash | null,
  ): Promise<void> {
    await trx
      .insertInto('employees')
      .values({
        tenantId,
        id: employee.id,
        roleId: employee.roleId,
        login: employee.login,
        fullName: employee.fullName,
        phone: employee.phone,
        email: employee.email,
        language: employee.language,
        storeScope: employee.scope === null ? 'all' : 'list',
      })
      .execute();
    await this.replaceStores(trx, tenantId, employee.id, employee.scope);
    await trx
      .insertInto('employeeCredentials')
      .values({
        tenantId,
        employeeId: employee.id,
        passwordHash: password.phc,
        passwordPepperVersion: password.pepperVersion,
        passwordChangedAt: sql`now()`,
        pinHash: pin?.phc ?? null,
        pinPepperVersion: pin?.pepperVersion ?? null,
      })
      .execute();
  }

  async updateEmployee(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    change: {
      fullName: string;
      login: string;
      phone: string;
      email?: string | null;
      language: 'ru' | 'tj';
    },
  ): Promise<void> {
    await trx
      .updateTable('employees')
      .set({ ...change, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async assign(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    roleId: string,
    scope: Scope,
  ): Promise<void> {
    await trx
      .updateTable('employees')
      .set({
        roleId,
        storeScope: scope === null ? 'all' : 'list',
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await this.replaceStores(trx, tenantId, id, scope);
  }

  private async replaceStores(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    scope: Scope,
  ): Promise<void> {
    await trx
      .deleteFrom('employeeStores')
      .where('tenantId', '=', tenantId)
      .where('employeeId', '=', employeeId)
      .execute();
    if (scope === null || scope.length === 0) return;
    await trx
      .insertInto('employeeStores')
      .values(scope.map((storeId) => ({ tenantId, employeeId, storeId })))
      .execute();
  }

  async setStatus(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    status: EmployeeStatus,
  ): Promise<void> {
    await trx
      .updateTable('employees')
      .set({ status, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async setPassword(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    hash: Hash,
  ): Promise<void> {
    await trx
      .insertInto('employeeCredentials')
      .values({
        tenantId,
        employeeId,
        passwordHash: hash.phc,
        passwordPepperVersion: hash.pepperVersion,
        passwordChangedAt: sql`now()`,
      })
      .onConflict((oc) =>
        oc.columns(['tenantId', 'employeeId']).doUpdateSet({
          passwordHash: hash.phc,
          passwordPepperVersion: hash.pepperVersion,
          passwordChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        }),
      )
      .execute();
  }

  /** A new PIN also lifts the lock after wrong attempts (ADR-0008). */
  async setPin(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    hash: Hash,
  ): Promise<void> {
    await trx
      .insertInto('employeeCredentials')
      .values({
        tenantId,
        employeeId,
        pinHash: hash.phc,
        pinPepperVersion: hash.pepperVersion,
        pinFailedAttempts: 0,
        pinLockedAt: null,
      })
      .onConflict((oc) =>
        oc.columns(['tenantId', 'employeeId']).doUpdateSet({
          pinHash: hash.phc,
          pinPepperVersion: hash.pepperVersion,
          pinFailedAttempts: 0,
          pinLockedAt: null,
          updatedAt: sql`now()`,
        }),
      )
      .execute();
  }

  private roleQuery(trx: TenantTransaction, tenantId: string) {
    return trx
      .selectFrom('roles as r')
      .select([
        'r.id',
        'r.name',
        'r.isOwner',
        'r.templateKey',
        sql<Permission[]>`coalesce((
          select array_agg(p.permission order by p.permission)
          from pharmacy.role_permissions p
          where p.tenant_id = r.tenant_id and p.role_id = r.id
        ), '{}')`.as('permissions'),
        sql<string>`(
          select count(*) from pharmacy.employees e
          where e.tenant_id = r.tenant_id and e.role_id = r.id and e.status <> 'archived'
        )`.as('employees'),
      ])
      .where('r.tenantId', '=', tenantId)
      .where('r.status', '=', 'active');
  }

  /** Active roles: the owner role first, then by name. */
  async listRoles(trx: TenantTransaction, tenantId: string): Promise<RoleRow[]> {
    const rows = await this.roleQuery(trx, tenantId)
      .orderBy('r.isOwner', 'desc')
      .orderBy(sql`r.name->>'ru'`)
      .orderBy('r.id')
      .execute();
    return rows.map((row) => ({ ...row, employees: Number(row.employees) }));
  }

  async findRole(trx: TenantTransaction, tenantId: string, id: string): Promise<RoleRow | null> {
    const row = await this.roleQuery(trx, tenantId).where('r.id', '=', id).executeTakeFirst();
    return row ? { ...row, employees: Number(row.employees) } : null;
  }

  /**
   * An active role of the network with this name (case-insensitive), other than `exceptId`. The
   * comparison is done here: lower() of the database depends on the cluster locale and may leave
   * Cyrillic as is.
   */
  async roleNameTaken(
    trx: TenantTransaction,
    tenantId: string,
    name: string,
    exceptId: string | null,
  ): Promise<boolean> {
    let query = trx
      .selectFrom('roles')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .where('status', '=', 'active');
    if (exceptId !== null) query = query.where('id', '<>', exceptId);
    const target = name.trim().toLocaleLowerCase('ru');
    const rows = await query.execute();
    return rows.some((row) =>
      Object.values((row.name ?? {}) as Record<string, unknown>).some(
        (value) => typeof value === 'string' && value.trim().toLocaleLowerCase('ru') === target,
      ),
    );
  }

  async insertRole(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    name: string,
    permissions: readonly Permission[],
  ): Promise<void> {
    await trx
      .insertInto('roles')
      .values({ tenantId, id, name: JSON.stringify({ ru: name, tj: name }), isOwner: false })
      .execute();
    await this.replacePermissions(trx, tenantId, id, permissions);
  }

  async updateRole(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    name: string,
    permissions: readonly Permission[],
  ): Promise<void> {
    await trx
      .updateTable('roles')
      .set({ name: JSON.stringify({ ru: name, tj: name }), updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await this.replacePermissions(trx, tenantId, id, permissions);
  }

  private async replacePermissions(
    trx: TenantTransaction,
    tenantId: string,
    roleId: string,
    permissions: readonly Permission[],
  ): Promise<void> {
    await trx
      .deleteFrom('rolePermissions')
      .where('tenantId', '=', tenantId)
      .where('roleId', '=', roleId)
      .execute();
    if (permissions.length === 0) return;
    await trx
      .insertInto('rolePermissions')
      .values(permissions.map((permission) => ({ tenantId, roleId, permission })))
      .execute();
  }

  /** Employees (not archived) that hold the role. */
  async roleEmployeeIds(trx: TenantTransaction, tenantId: string, roleId: string): Promise<string[]> {
    const rows = await trx
      .selectFrom('employees')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('roleId', '=', roleId)
      .where('status', '<>', 'archived')
      .execute();
    return rows.map((row) => row.id);
  }

  /** The editor's role: whether it is «Владелец». */
  async isOwnerEmployee(trx: TenantTransaction, tenantId: string, employeeId: string): Promise<boolean> {
    const row = await trx
      .selectFrom('employees as e')
      .innerJoin('roles as r', (join) =>
        join.onRef('r.tenantId', '=', 'e.tenantId').onRef('r.id', '=', 'e.roleId'),
      )
      .select('r.isOwner')
      .where('e.tenantId', '=', tenantId)
      .where('e.id', '=', employeeId)
      .executeTakeFirst();
    return row?.isOwner === true;
  }
}
