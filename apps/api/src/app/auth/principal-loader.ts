import { Injectable } from '@nestjs/common';
import {
  isPermission,
  type Permission,
  permissions,
} from '@pharmacy/shared-domain';
import { TenantDatabase } from '../../core/database';

// What the session snapshot is rebuilt from when the permissions version changed (auth design
// 2026-10-02, section 7, step 4; ADR-0018).
export interface PrincipalSnapshot {
  status: string;
  permissions: Permission[];
  storeScope: 'all' | string[];
  permissionsVersion: number;
}

// Reads an employee's status, role permissions, store scope and permissions_version in one tenant
// transaction (RLS by tenantId). The owner role holds the whole catalog; an archived role holds
// nothing; permission strings outside the catalog are dropped.
@Injectable()
export class PrincipalLoader {
  constructor(private readonly db: TenantDatabase) {}

  reload(
    tenantId: string,
    employeeId: string,
  ): Promise<PrincipalSnapshot | null> {
    return this.db.withTenant(tenantId, async (trx) => {
      const employee = await trx
        .selectFrom('employees')
        .innerJoin('roles', (join) =>
          join
            .onRef('roles.tenantId', '=', 'employees.tenantId')
            .onRef('roles.id', '=', 'employees.roleId'),
        )
        .select([
          'employees.status',
          'employees.storeScope',
          'employees.permissionsVersion',
          'employees.roleId',
          'roles.isOwner',
          'roles.status as roleStatus',
        ])
        .where('employees.tenantId', '=', tenantId)
        .where('employees.id', '=', employeeId)
        .executeTakeFirst();
      if (!employee) return null;

      const permissionsVersion = Number(employee.permissionsVersion);
      if (!Number.isSafeInteger(permissionsVersion)) {
        throw new Error('permissions_version is out of the safe integer range');
      }

      let granted: Permission[];
      if (employee.roleStatus !== 'active') {
        granted = [];
      } else if (employee.isOwner) {
        granted = [...permissions];
      } else {
        const rows = await trx
          .selectFrom('rolePermissions')
          .select('permission')
          .where('tenantId', '=', tenantId)
          .where('roleId', '=', employee.roleId)
          .orderBy('permission')
          .execute();
        granted = rows.map((row) => row.permission).filter(isPermission);
      }

      let storeScope: 'all' | string[] = 'all';
      if (employee.storeScope !== 'all') {
        const stores = await trx
          .selectFrom('employeeStores')
          .select('storeId')
          .where('tenantId', '=', tenantId)
          .where('employeeId', '=', employeeId)
          .orderBy('storeId')
          .execute();
        storeScope = stores.map((row) => row.storeId);
      }

      return {
        status: employee.status,
        permissions: granted,
        storeScope,
        permissionsVersion,
      };
    });
  }
}
