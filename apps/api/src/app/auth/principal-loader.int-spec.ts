import { randomUUID } from 'node:crypto';
import { permissions } from '@pharmacy/shared-domain';
import { closeAll } from '../../../test/integration/connections';
import { testDatabaseUrls } from '../../../test/integration/database-urls';
import {
  asTenant,
  seedEmployee,
  seedTenant,
  type SeededTenant,
} from '../../../test/integration/seed';
import { TenantDatabase } from '../../core/database';
import { PrincipalLoader } from './principal-loader';

// PrincipalLoader.reload on the real schema as pharmacy_app (RLS): status, the role's permissions
// (the whole catalog for the owner role, none for an archived role, unknown strings dropped),
// store scope and permissions_version of one employee.

let db: TenantDatabase;
let loader: PrincipalLoader;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  db = new TenantDatabase({
    url: testDatabaseUrls(process.env).app,
    poolMax: 2,
    statementTimeoutMs: 5000,
    lockTimeoutMs: 2000,
    connectionTimeoutMs: 5000,
  });
  loader = new PrincipalLoader(db);
  a = await seedTenant('loader-a');
  b = await seedTenant('loader-b');
});

afterAll(async () => {
  await db.onModuleDestroy();
  await closeAll();
});

async function grant(
  tenantId: string,
  roleId: string,
  keys: string[],
): Promise<void> {
  await asTenant(tenantId, async (client) => {
    for (const permission of keys) {
      await client.query(
        'insert into role_permissions (tenant_id, role_id, permission) values ($1, $2, $3)',
        [tenantId, roleId, permission],
      );
    }
  });
}

describe('PrincipalLoader.reload', () => {
  it('returns null for an unknown employee', async () => {
    await expect(loader.reload(a.tenantId, randomUUID())).resolves.toBeNull();
  });

  it('loads status, role permissions without unknown strings, scope "all" and the version', async () => {
    const { employeeId, roleId } = await seedEmployee(a.tenantId, {
      login: 'loader-cashier',
    });
    await grant(a.tenantId, roleId, [
      'pos:view',
      'catalog:view',
      'legacy:removed',
    ]);

    const loaded = await loader.reload(a.tenantId, employeeId);

    expect(loaded).toEqual({
      status: 'active',
      tenantStatus: 'active',
      permissions: expect.arrayContaining(['pos:view', 'catalog:view']),
      storeScope: 'all',
      permissionsVersion: 1,
    });
    expect(loaded?.permissions).toHaveLength(2);
  });

  it('gives the owner role the whole catalog', async () => {
    const roleId = randomUUID();
    await asTenant(a.tenantId, (client) =>
      client.query(
        'insert into roles (id, tenant_id, name, is_owner) values ($1, $2, $3, true)',
        [roleId, a.tenantId, { ru: 'Владелец' }],
      ),
    );
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'loader-owner',
      roleId,
    });

    const loaded = await loader.reload(a.tenantId, employeeId);

    expect([...(loaded?.permissions ?? [])].sort()).toEqual(
      [...permissions].sort(),
    );
  });

  it('gives an archived role no permissions', async () => {
    const { employeeId, roleId } = await seedEmployee(a.tenantId, {
      login: 'loader-archived-role',
    });
    await grant(a.tenantId, roleId, ['pos:view']);
    await asTenant(a.tenantId, (client) =>
      client.query(
        "update roles set status = 'archived', archived_at = now() where tenant_id = $1 and id = $2",
        [a.tenantId, roleId],
      ),
    );

    await expect(loader.reload(a.tenantId, employeeId)).resolves.toMatchObject({
      permissions: [],
    });
  });

  it('loads a list scope, a blocked status and a grown version', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'loader-list',
    });
    await asTenant(a.tenantId, async (client) => {
      await client.query(
        'insert into employee_stores (tenant_id, employee_id, store_id) values ($1, $2, $3)',
        [a.tenantId, employeeId, a.storeId],
      );
      await client.query(
        `update employees set store_scope = 'list', status = 'blocked',
                permissions_version = permissions_version + 4
          where tenant_id = $1 and id = $2`,
        [a.tenantId, employeeId],
      );
    });

    await expect(loader.reload(a.tenantId, employeeId)).resolves.toEqual({
      status: 'blocked',
      tenantStatus: 'active',
      permissions: [],
      storeScope: [a.storeId],
      permissionsVersion: 5,
    });
  });

  it('does not see an employee of another tenant', async () => {
    const { employeeId } = await seedEmployee(b.tenantId, {
      login: 'loader-other',
    });
    await expect(loader.reload(a.tenantId, employeeId)).resolves.toBeNull();
    await expect(loader.reload(b.tenantId, employeeId)).resolves.toMatchObject({
      status: 'active',
    });
  });
});
