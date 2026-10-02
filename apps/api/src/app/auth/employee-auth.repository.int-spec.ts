import { closeAll } from '../../../test/integration/connections';
import { testDatabaseUrls } from '../../../test/integration/database-urls';
import {
  asTenant,
  seedEmployee,
  seedTenant,
  type SeededTenant,
} from '../../../test/integration/seed';
import { newId, TenantDatabase } from '../../core/database';
import { EmployeeAuthRepository } from './employee-auth.repository';

// EmployeeAuthRepository on the real schema as pharmacy_app (RLS by the transaction tenant):
// credentials of the login, the session profile, the active stores of a scope, last_login_at and
// the guarded re-hash.

let db: TenantDatabase;
const repository = new EmployeeAuthRepository();
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
  a = await seedTenant('auth-repo-a');
  b = await seedTenant('auth-repo-b');
});

afterAll(async () => {
  await db.onModuleDestroy();
  await closeAll();
});

async function setPassword(
  tenantId: string,
  employeeId: string,
  phc: string,
  version: number,
) {
  await asTenant(tenantId, (client) =>
    client.query(
      `insert into employee_credentials (tenant_id, employee_id, password_hash, password_pepper_version)
       values ($1, $2, $3, $4)`,
      [tenantId, employeeId, phc, version],
    ),
  );
}

async function addStore(
  tenant: SeededTenant,
  input: {
    code: string;
    name: string;
    status?: 'active' | 'closed';
    mode?: string;
  },
): Promise<string> {
  const id = newId();
  await asTenant(tenant.tenantId, (client) =>
    client.query(
      `insert into stores (id, tenant_id, legal_entity_id, name, code, address, kind, mode, status, closed_at)
       values ($1, $2, $3, $4, $5, $6, 'pharmacy', $7, $8, $9)`,
      [
        id,
        tenant.tenantId,
        tenant.legalEntityId,
        input.name,
        input.code,
        `${input.name} address`,
        input.mode ?? 'online',
        input.status ?? 'active',
        input.status === 'closed' ? new Date() : null,
      ],
    ),
  );
  return id;
}

describe('findCredentials', () => {
  it('returns the status and the password hash with its pepper version', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'repo-cred',
    });
    await setPassword(a.tenantId, employeeId, '$scrypt$test', 3);

    await expect(
      db.withTenant(a.tenantId, (trx) =>
        repository.findCredentials(trx, a.tenantId, employeeId),
      ),
    ).resolves.toEqual({
      status: 'active',
      passwordHash: '$scrypt$test',
      passwordPepperVersion: 3,
    });
  });

  it('returns nulls for an employee without a credentials row', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'repo-nocred',
    });

    await expect(
      db.withTenant(a.tenantId, (trx) =>
        repository.findCredentials(trx, a.tenantId, employeeId),
      ),
    ).resolves.toEqual({
      status: 'active',
      passwordHash: null,
      passwordPepperVersion: null,
    });
  });

  it('does not see an employee of another tenant', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'repo-foreign',
    });

    await expect(
      db.withTenant(b.tenantId, (trx) =>
        repository.findCredentials(trx, a.tenantId, employeeId),
      ),
    ).resolves.toBeNull();
  });
});

describe('loadProfile', () => {
  it('loads the employee, the role, the tenant and the network settings', async () => {
    const roleId = newId();
    await asTenant(a.tenantId, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, name, template_key) values ($1, $2, $3, 'manager')`,
        [roleId, a.tenantId, { ru: 'Заведующий', tj: 'Мудир' }],
      );
      await client.query(
        `insert into tenant_settings (tenant_id, default_language, cashier_session_idle_min)
         values ($1, 'tj', 20)`,
        [a.tenantId],
      );
    });
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'repo-profile',
      phone: '+992900000201',
      roleId,
    });

    const profile = await db.withTenant(a.tenantId, (trx) =>
      repository.loadProfile(trx, a.tenantId, employeeId),
    );

    expect(profile).toEqual({
      employee: {
        id: employeeId,
        fullName: 'Test employee repo-profile',
        login: 'repo-profile',
        phone: '+992900000201',
        language: null,
      },
      role: {
        id: roleId,
        name: { ru: 'Заведующий', tj: 'Мудир' },
        isOwner: false,
        templateKey: 'manager',
      },
      tenant: { id: a.tenantId, name: 'Test network auth-repo-a' },
      settings: { defaultLanguage: 'tj', cashierSessionIdleMin: 20 },
    });
  });

  it('falls back to the column defaults without a tenant_settings row', async () => {
    const { employeeId } = await seedEmployee(b.tenantId, {
      login: 'repo-nosettings',
    });

    const profile = await db.withTenant(b.tenantId, (trx) =>
      repository.loadProfile(trx, b.tenantId, employeeId),
    );

    expect(profile?.settings).toEqual({
      defaultLanguage: 'ru',
      cashierSessionIdleMin: 15,
    });
  });

  it('returns null for an unknown employee', async () => {
    await expect(
      db.withTenant(a.tenantId, (trx) =>
        repository.loadProfile(trx, a.tenantId, newId()),
      ),
    ).resolves.toBeNull();
  });
});

describe('activeStores', () => {
  it('lists the active stores of the network for scope all and of the list otherwise', async () => {
    const tenant = await seedTenant('auth-repo-stores');
    const second = await addStore(tenant, {
      code: '02',
      name: 'B store',
      mode: 'offline_pending',
    });
    await addStore(tenant, { code: '03', name: 'C closed', status: 'closed' });

    const all = await db.withTenant(tenant.tenantId, (trx) =>
      repository.activeStores(trx, tenant.tenantId, 'all'),
    );
    expect(all).toEqual([
      {
        id: second,
        name: 'B store',
        address: 'B store address',
        mode: 'offline_pending',
      },
      {
        id: tenant.storeId,
        name: 'Test store auth-repo-stores',
        address: 'Test store address',
        mode: 'online',
      },
    ]);

    const listed = await db.withTenant(tenant.tenantId, (trx) =>
      repository.activeStores(trx, tenant.tenantId, [second]),
    );
    expect(listed.map((store) => store.id)).toEqual([second]);

    const empty = await db.withTenant(tenant.tenantId, (trx) =>
      repository.activeStores(trx, tenant.tenantId, []),
    );
    expect(empty).toEqual([]);
  });

  it('never lists a closed store or a store of another tenant, even when named in the scope', async () => {
    const tenant = await seedTenant('auth-repo-closed');
    const closed = await addStore(tenant, {
      code: '09',
      name: 'Closed',
      status: 'closed',
    });

    const listed = await db.withTenant(tenant.tenantId, (trx) =>
      repository.activeStores(trx, tenant.tenantId, [closed, a.storeId]),
    );
    expect(listed).toEqual([]);
  });
});

describe('recordLogin and updatePasswordHash', () => {
  it('writes last_login_at', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'repo-lastlogin',
    });

    await db.withTenant(a.tenantId, (trx) =>
      repository.recordLogin(trx, a.tenantId, employeeId),
    );

    const { rows } = await asTenant(a.tenantId, (client) =>
      client.query<{ last_login_at: Date | null }>(
        'select last_login_at from employees where tenant_id = $1 and id = $2',
        [a.tenantId, employeeId],
      ),
    );
    expect(rows[0].last_login_at).toBeInstanceOf(Date);
  });

  it('replaces the hash only while it is still the one that was verified', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'repo-rehash',
    });
    await setPassword(a.tenantId, employeeId, '$scrypt$old', 1);

    await db.withTenant(a.tenantId, (trx) =>
      repository.updatePasswordHash(
        trx,
        a.tenantId,
        employeeId,
        '$scrypt$other',
        {
          phc: '$scrypt$lost',
          pepperVersion: 2,
        },
      ),
    );
    await db.withTenant(a.tenantId, (trx) =>
      repository.updatePasswordHash(
        trx,
        a.tenantId,
        employeeId,
        '$scrypt$old',
        {
          phc: '$scrypt$new',
          pepperVersion: 2,
        },
      ),
    );

    await expect(
      db.withTenant(a.tenantId, (trx) =>
        repository.findCredentials(trx, a.tenantId, employeeId),
      ),
    ).resolves.toEqual({
      status: 'active',
      passwordHash: '$scrypt$new',
      passwordPepperVersion: 2,
    });
  });
});
