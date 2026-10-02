import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** What a sign-in checks before the password: never logged, the hash never leaves the service. */
export interface LoginCredentials {
  status: string;
  passwordHash: string | null;
  passwordPepperVersion: number | null;
}

/** Rows the session profile is built from (session-profile.ts). */
export interface EmployeeProfile {
  employee: {
    id: string;
    fullName: string;
    login: string;
    phone: string | null;
    /** Database language `ru` | `tj`; null — the network default. */
    language: string | null;
  };
  role: {
    id: string;
    /** Language map {"ru": …, "tj": …} (jsonb). */
    name: unknown;
    isOwner: boolean;
    templateKey: string | null;
  };
  tenant: { id: string; name: string };
  settings: { defaultLanguage: string; cashierSessionIdleMin: number };
}

export interface ProfileStore {
  id: string;
  name: string;
  address: string;
  /** Database mode `online` | `offline_pending` | `offline`. */
  mode: string;
}

// Column defaults of tenant_settings, for a tenant without a settings row.
const DEFAULT_LANGUAGE = 'ru';
const DEFAULT_IDLE_MINUTES = 15;

// Data access of sign-in and the session profile (auth design 2026-10-02, section 6). Every query
// runs in the caller's tenant transaction and filters by tenant_id; RLS is the second line.
@Injectable()
export class EmployeeAuthRepository {
  /** Status and password hash of an employee; null when the employee is not in this tenant. */
  async findCredentials(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<LoginCredentials | null> {
    const row = await trx
      .selectFrom('employees')
      .leftJoin('employeeCredentials', (join) =>
        join
          .onRef('employeeCredentials.tenantId', '=', 'employees.tenantId')
          .onRef('employeeCredentials.employeeId', '=', 'employees.id'),
      )
      .select([
        'employees.status',
        'employeeCredentials.passwordHash',
        'employeeCredentials.passwordPepperVersion',
      ])
      .where('employees.tenantId', '=', tenantId)
      .where('employees.id', '=', employeeId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      status: row.status,
      passwordHash: row.passwordHash ?? null,
      passwordPepperVersion: row.passwordPepperVersion ?? null,
    };
  }

  /**
   * Replaces the password hash after a successful check, only while the stored hash is still the
   * verified one: a password changed meanwhile is never overwritten with the old secret.
   */
  async updatePasswordHash(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    verifiedPhc: string,
    next: { phc: string; pepperVersion: number },
  ): Promise<void> {
    await trx
      .updateTable('employeeCredentials')
      .set({
        passwordHash: next.phc,
        passwordPepperVersion: next.pepperVersion,
        updatedAt: sql<Date>`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('employeeId', '=', employeeId)
      .where('passwordHash', '=', verifiedPhc)
      .execute();
  }

  async recordLogin(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<void> {
    await trx
      .updateTable('employees')
      .set({ lastLoginAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', employeeId)
      .execute();
  }

  /** The employee, the role, the tenant and the network settings; null for an unknown employee. */
  async loadProfile(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeProfile | null> {
    const row = await trx
      .selectFrom('employees')
      .innerJoin('roles', (join) =>
        join
          .onRef('roles.tenantId', '=', 'employees.tenantId')
          .onRef('roles.id', '=', 'employees.roleId'),
      )
      .innerJoin('tenants', 'tenants.id', 'employees.tenantId')
      .leftJoin(
        'tenantSettings',
        'tenantSettings.tenantId',
        'employees.tenantId',
      )
      .select([
        'employees.id',
        'employees.fullName',
        'employees.login',
        'employees.phone',
        'employees.language',
        'roles.id as roleId',
        'roles.name as roleName',
        'roles.isOwner',
        'roles.templateKey',
        'tenants.id as tenantId',
        'tenants.name as tenantName',
        'tenantSettings.defaultLanguage',
        'tenantSettings.cashierSessionIdleMin',
      ])
      .where('employees.tenantId', '=', tenantId)
      .where('employees.id', '=', employeeId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      employee: {
        id: row.id,
        fullName: row.fullName,
        login: row.login,
        phone: row.phone,
        language: row.language,
      },
      role: {
        id: row.roleId,
        name: row.roleName,
        isOwner: row.isOwner,
        templateKey: row.templateKey,
      },
      tenant: { id: row.tenantId, name: row.tenantName },
      settings: {
        defaultLanguage: row.defaultLanguage ?? DEFAULT_LANGUAGE,
        cashierSessionIdleMin:
          row.cashierSessionIdleMin ?? DEFAULT_IDLE_MINUTES,
      },
    };
  }

  /** Active stores of a scope: the whole network for 'all', otherwise the listed ones. */
  async activeStores(
    trx: TenantTransaction,
    tenantId: string,
    storeScope: 'all' | readonly string[],
  ): Promise<ProfileStore[]> {
    if (storeScope !== 'all' && storeScope.length === 0) return [];
    let query = trx
      .selectFrom('stores')
      .select(['id', 'name', 'address', 'mode'])
      .where('tenantId', '=', tenantId)
      .where('status', '=', 'active');
    if (storeScope !== 'all') query = query.where('id', 'in', [...storeScope]);
    return query.orderBy('name').orderBy('id').execute();
  }
}
