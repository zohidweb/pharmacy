import { closeAll } from '../../../test/integration/connections';
import { testDatabaseUrls } from '../../../test/integration/database-urls';
import {
  asTenant,
  seedEmployee,
  seedTenant,
  type SeededTenant,
} from '../../../test/integration/seed';
import { TenantDatabase } from '../../core/database';
import { EmployeeAuthRepository } from './employee-auth.repository';
import { PermissionsVersionRepository } from './permissions-version.repository';

// The SQL of the own profile, the password change and the permissions version on the real schema
// as pharmacy_app (RLS by the transaction tenant).

let db: TenantDatabase;
const repository = new EmployeeAuthRepository();
const versions = new PermissionsVersionRepository();
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
  a = await seedTenant('me-a');
  b = await seedTenant('me-b');
});

afterAll(async () => {
  await db.onModuleDestroy();
  await closeAll();
});

async function seedCredentials(
  tenantId: string,
  employeeId: string,
  columns: { phc?: string; pin?: string },
) {
  await asTenant(tenantId, (client) =>
    client.query(
      `insert into employee_credentials
         (tenant_id, employee_id, password_hash, password_pepper_version, pin_hash, pin_pepper_version)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        employeeId,
        columns.phc ?? null,
        columns.phc ? 1 : null,
        columns.pin ?? null,
        columns.pin ? 1 : null,
      ],
    ),
  );
}

describe('changePassword', () => {
  it('replaces the hash only while the stored one is the verified one', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, { login: 'me-pw' });
    await seedCredentials(a.tenantId, employeeId, { phc: '$scrypt$old' });

    const stale = await db.withTenant(a.tenantId, (trx) =>
      repository.changePassword(trx, a.tenantId, employeeId, '$scrypt$other', {
        phc: '$scrypt$new',
        pepperVersion: 2,
      }),
    );
    const fresh = await db.withTenant(a.tenantId, (trx) =>
      repository.changePassword(trx, a.tenantId, employeeId, '$scrypt$old', {
        phc: '$scrypt$new',
        pepperVersion: 2,
      }),
    );

    expect(stale).toBe(false);
    expect(fresh).toBe(true);
    const { rows } = await asTenant(a.tenantId, (client) =>
      client.query(
        `select password_hash, password_pepper_version, password_changed_at
           from employee_credentials where tenant_id = $1 and employee_id = $2`,
        [a.tenantId, employeeId],
      ),
    );
    expect(rows[0].password_hash).toBe('$scrypt$new');
    expect(rows[0].password_pepper_version).toBe(2);
    expect(rows[0].password_changed_at).not.toBeNull();
  });

  it('does not touch an employee of another tenant', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, { login: 'me-pw-x' });
    await seedCredentials(a.tenantId, employeeId, { phc: '$scrypt$old' });

    const changed = await db.withTenant(b.tenantId, (trx) =>
      repository.changePassword(trx, a.tenantId, employeeId, '$scrypt$old', {
        phc: '$scrypt$new',
        pepperVersion: 2,
      }),
    );

    expect(changed).toBe(false);
  });
});

describe('loadMeExtras and updateLanguage', () => {
  it('reports whether a PIN is set and the last sign-in', async () => {
    const withPin = await seedEmployee(a.tenantId, { login: 'me-pin' });
    const withoutPin = await seedEmployee(a.tenantId, { login: 'me-nopin' });
    await seedCredentials(a.tenantId, withPin.employeeId, {
      phc: '$scrypt$p',
      pin: '$scrypt$pin',
    });
    await seedCredentials(a.tenantId, withoutPin.employeeId, {
      phc: '$scrypt$p',
    });
    await db.withTenant(a.tenantId, (trx) =>
      repository.recordLogin(trx, a.tenantId, withPin.employeeId),
    );

    const first = await db.withTenant(a.tenantId, (trx) =>
      repository.loadMeExtras(trx, a.tenantId, withPin.employeeId),
    );
    const second = await db.withTenant(a.tenantId, (trx) =>
      repository.loadMeExtras(trx, a.tenantId, withoutPin.employeeId),
    );

    expect(first?.pinSet).toBe(true);
    expect(first?.lastLoginAt).toBeInstanceOf(Date);
    expect(second).toEqual({ lastLoginAt: null, pinSet: false });
  });

  it('answers null for an employee of another tenant', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, { login: 'me-x' });

    await expect(
      db.withTenant(b.tenantId, (trx) =>
        repository.loadMeExtras(trx, a.tenantId, employeeId),
      ),
    ).resolves.toBeNull();
  });

  it('stores the language of the employee', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, { login: 'me-lang' });

    await db.withTenant(a.tenantId, (trx) =>
      repository.updateLanguage(trx, a.tenantId, employeeId, 'tj'),
    );

    const { rows } = await asTenant(a.tenantId, (client) =>
      client.query(
        'select language from employees where tenant_id = $1 and id = $2',
        [a.tenantId, employeeId],
      ),
    );
    expect(rows[0].language).toBe('tj');
  });
});

describe('PermissionsVersionRepository.bump', () => {
  it('increments the version of the listed employees only and returns the new numbers', async () => {
    const one = await seedEmployee(a.tenantId, { login: 'me-v1' });
    const two = await seedEmployee(a.tenantId, { login: 'me-v2' });
    const other = await seedEmployee(a.tenantId, { login: 'me-v3' });
    const read = async (id: string) =>
      (
        await asTenant(a.tenantId, (client) =>
          client.query(
            'select permissions_version from employees where tenant_id = $1 and id = $2',
            [a.tenantId, id],
          ),
        )
      ).rows[0].permissions_version;
    const before = Number(await read(one.employeeId));

    const bumped = await db.withTenant(a.tenantId, (trx) =>
      versions.bump(trx, a.tenantId, [one.employeeId, two.employeeId]),
    );

    expect(bumped).toHaveLength(2);
    expect(bumped.find((row) => row.employeeId === one.employeeId)).toEqual({
      employeeId: one.employeeId,
      version: before + 1,
    });
    expect(Number(await read(one.employeeId))).toBe(before + 1);
    expect(Number(await read(other.employeeId))).toBe(before);
  });

  it('does not touch employees of another tenant', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, { login: 'me-vx' });

    const bumped = await db.withTenant(b.tenantId, (trx) =>
      versions.bump(trx, a.tenantId, [employeeId]),
    );

    expect(bumped).toEqual([]);
  });
});
