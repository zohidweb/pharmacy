import type { PoolClient } from 'pg';
import { newId } from '../../src/core/database/ids';
import { appPool, platformPool } from './connections';

export interface SeededTenant {
  tenantId: string;
  legalEntityId: string;
  storeId: string;
}

// Runs work as pharmacy_app in one transaction with the tenant context set the way the
// application sets it (transaction-local set_config). Commits on success, rolls back on error.
export async function asTenant<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool().connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

// Synthetic tenant: the tenants row is created on the platform path (as an operator would),
// the legal entity and the store on the tenant path under RLS. `code` must be unique per test run.
export async function seedTenant(code: string): Promise<SeededTenant> {
  const tenantId = newId();
  const legalEntityId = newId();
  const storeId = newId();

  await platformPool().query(
    'insert into tenants (id, code, name) values ($1, $2, $3)',
    [tenantId, code, `Test network ${code}`],
  );
  await asTenant(tenantId, async (client) => {
    await client.query(
      `insert into legal_entities (id, tenant_id, name, tax_id, legal_address)
       values ($1, $2, $3, $4, $5)`,
      [
        legalEntityId,
        tenantId,
        `Test entity ${code}`,
        '000000000',
        'Test legal address',
      ],
    );
    await client.query(
      `insert into stores (id, tenant_id, legal_entity_id, name, code, address, kind)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        storeId,
        tenantId,
        legalEntityId,
        `Test store ${code}`,
        '01',
        'Test store address',
        'pharmacy',
      ],
    );
  });

  return { tenantId, legalEntityId, storeId };
}

export interface SeedEmployeeInput {
  login: string;
  phone?: string;
  email?: string;
  roleId?: string;
}

export interface SeededEmployee {
  employeeId: string;
  roleId: string;
}

// Synthetic employee with store scope 'all' on the tenant path. Without roleId a new role is
// created for it. login, phone and email are globally unique (unique per test run).
export async function seedEmployee(
  tenantId: string,
  input: SeedEmployeeInput,
): Promise<SeededEmployee> {
  const employeeId = newId();
  const roleId = input.roleId ?? newId();

  await asTenant(tenantId, async (client) => {
    if (!input.roleId) {
      await client.query(
        `insert into roles (id, tenant_id, name) values ($1, $2, $3)`,
        [roleId, tenantId, { ru: `Test role ${input.login}` }],
      );
    }
    await client.query(
      `insert into employees (id, tenant_id, role_id, login, full_name, phone, email, store_scope)
       values ($1, $2, $3, $4, $5, $6, $7, 'all')`,
      [
        employeeId,
        tenantId,
        roleId,
        input.login,
        `Test employee ${input.login}`,
        input.phone ?? null,
        input.email ?? null,
      ],
    );
  });

  return { employeeId, roleId };
}
