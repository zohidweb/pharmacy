import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeAll } from '../../../test/integration/connections';
import { testDatabaseUrls } from '../../../test/integration/database-urls';
import {
  asTenant,
  seedEmployee,
  seedTenant,
  type SeededTenant,
} from '../../../test/integration/seed';
import { platformPool } from '../../../test/integration/connections';
import { sha256Hex } from '../../core/crypto';
import { TenantDatabase } from '../../core/database';
import { hashActivationCode, normalizeActivationCode } from './activation-code';
import { EmployeeAuthRepository } from './employee-auth.repository';

// Activation on the real schema as pharmacy_app (RLS by the transaction tenant): the repository
// consumes a code atomically, and scripts/create-activation-code.mjs issues one that the
// repository accepts (auth design 2026-10-02, section 6).

const run = promisify(execFile);
const SCRIPT = join(__dirname, '../../../scripts/create-activation-code.mjs');
const NEXT = { phc: '$scrypt$activated', pepperVersion: 7 };

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
  a = await seedTenant('activation-a');
  b = await seedTenant('activation-b');
});

afterAll(async () => {
  await db.onModuleDestroy();
  await closeAll();
});

async function putCode(
  tenantId: string,
  employeeId: string,
  code: string,
  expiresInSeconds: number,
  password?: { phc: string; version: number },
) {
  await asTenant(tenantId, (client) =>
    client.query(
      `insert into employee_credentials
         (tenant_id, employee_id, one_time_code_hash, one_time_code_expires_at,
          password_hash, password_pepper_version)
       values ($1, $2, $3, now() + make_interval(secs => $4), $5, $6)`,
      [
        tenantId,
        employeeId,
        sha256Hex(code),
        expiresInSeconds,
        password?.phc ?? null,
        password?.version ?? null,
      ],
    ),
  );
}

interface CredentialRow {
  password_hash: string | null;
  password_pepper_version: number | null;
  password_changed_at: Date | null;
  one_time_code_hash: string | null;
  one_time_code_expires_at: Date | null;
}

async function credentials(
  tenantId: string,
  employeeId: string,
): Promise<CredentialRow> {
  return asTenant(tenantId, async (client) => {
    const { rows } = await client.query<CredentialRow>(
      `select password_hash, password_pepper_version, password_changed_at,
              one_time_code_hash, one_time_code_expires_at
       from employee_credentials where tenant_id = $1 and employee_id = $2`,
      [tenantId, employeeId],
    );
    return rows[0];
  });
}

const consume = (
  tenantId: string,
  employeeId: string,
  code: string,
  scope = tenantId,
) =>
  db.withTenant(scope, (trx) =>
    repository.consumeActivationCode(
      trx,
      tenantId,
      employeeId,
      sha256Hex(code),
      NEXT,
    ),
  );

describe('EmployeeAuthRepository.consumeActivationCode', () => {
  it('sets the password and clears the code, once', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-ok',
    });
    await putCode(a.tenantId, employeeId, 'CODEOK', 3600);

    await expect(consume(a.tenantId, employeeId, 'CODEOK')).resolves.toBe(true);

    const row = await credentials(a.tenantId, employeeId);
    expect(row.password_hash).toBe(NEXT.phc);
    expect(row.password_pepper_version).toBe(NEXT.pepperVersion);
    expect(row.password_changed_at).toBeInstanceOf(Date);
    expect(row.one_time_code_hash).toBeNull();
    expect(row.one_time_code_expires_at).toBeNull();
    // The same code does not work twice.
    await expect(consume(a.tenantId, employeeId, 'CODEOK')).resolves.toBe(
      false,
    );
  });

  it('refuses an expired code and keeps the old password', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-expired',
    });
    await putCode(a.tenantId, employeeId, 'CODEOLD', -60, {
      phc: '$scrypt$old',
      version: 1,
    });

    await expect(consume(a.tenantId, employeeId, 'CODEOLD')).resolves.toBe(
      false,
    );

    const row = await credentials(a.tenantId, employeeId);
    expect(row.password_hash).toBe('$scrypt$old');
    expect(row.one_time_code_hash).toBe(sha256Hex('CODEOLD'));
  });

  it('refuses a wrong code and keeps the right one valid', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-wrong',
    });
    await putCode(a.tenantId, employeeId, 'RIGHT', 3600);

    await expect(consume(a.tenantId, employeeId, 'WRONG')).resolves.toBe(false);
    await expect(consume(a.tenantId, employeeId, 'RIGHT')).resolves.toBe(true);
  });

  it('refuses an employee without a credentials row', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-norow',
    });

    await expect(consume(a.tenantId, employeeId, 'ANY')).resolves.toBe(false);
  });

  it('does not consume the code of an archived employee', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-archived',
    });
    await putCode(a.tenantId, employeeId, 'CODEARCH', 3600);
    await asTenant(a.tenantId, (client) =>
      client.query(
        `update employees set status = 'archived', archived_at = now()
         where tenant_id = $1 and id = $2`,
        [a.tenantId, employeeId],
      ),
    );

    await expect(consume(a.tenantId, employeeId, 'CODEARCH')).resolves.toBe(
      false,
    );
    expect((await credentials(a.tenantId, employeeId)).one_time_code_hash).toBe(
      sha256Hex('CODEARCH'),
    );
  });

  it('does not consume the code of a blocked employee', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-blocked-emp',
    });
    await putCode(a.tenantId, employeeId, 'CODEBLK', 3600);
    await asTenant(a.tenantId, (client) =>
      client.query(
        `update employees set status = 'blocked' where tenant_id = $1 and id = $2`,
        [a.tenantId, employeeId],
      ),
    );

    await expect(consume(a.tenantId, employeeId, 'CODEBLK')).resolves.toBe(
      false,
    );
    expect((await credentials(a.tenantId, employeeId)).one_time_code_hash).toBe(
      sha256Hex('CODEBLK'),
    );
  });

  it('does not consume the code of a blocked network', async () => {
    const blocked = await seedTenant('activation-blocked');
    const { employeeId } = await seedEmployee(blocked.tenantId, {
      login: 'act-blocked-net',
    });
    await putCode(blocked.tenantId, employeeId, 'CODENET', 3600);
    await platformPool().query(
      `update tenants set status = 'blocked' where id = $1`,
      [blocked.tenantId],
    );

    await expect(
      consume(blocked.tenantId, employeeId, 'CODENET'),
    ).resolves.toBe(false);
    expect(
      (await credentials(blocked.tenantId, employeeId)).one_time_code_hash,
    ).toBe(sha256Hex('CODENET'));
  });

  it('cannot reach an employee of another tenant', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-foreign',
    });
    await putCode(a.tenantId, employeeId, 'CODEFOR', 3600);

    // Tenant B's transaction, tenant A's ids: RLS hides the row.
    await expect(
      consume(a.tenantId, employeeId, 'CODEFOR', b.tenantId),
    ).resolves.toBe(false);
    expect((await credentials(a.tenantId, employeeId)).one_time_code_hash).toBe(
      sha256Hex('CODEFOR'),
    );
  });
});

describe('scripts/create-activation-code.mjs', () => {
  const scriptEnv = (extra: Record<string, string> = {}) => ({
    PATH: process.env['PATH'] ?? '',
    SystemRoot: process.env['SystemRoot'] ?? '',
    DATABASE_URL: testDatabaseUrls(process.env).app,
    ...extra,
  });

  const issue = (login: string, extra: Record<string, string> = {}) =>
    run(process.execPath, [SCRIPT, '--login', login], {
      env: scriptEnv(extra),
    });

  it('prints the code once; the stored hash matches and the code activates', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-script-ok',
      phone: '+992900990001',
    });

    const { stdout, stderr } = await issue(' ACT-Script-OK ');

    expect(stderr).toBe('');
    const lines = stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    const display = /^Activation code: (\S+)$/.exec(lines[0])?.[1] ?? '';
    expect(display).toMatch(/^([A-Z2-7]{4}-){6}[A-Z2-7]{2}$/);
    const expiresAt = /^Valid until: (\S+)$/.exec(lines[1])?.[1] ?? '';
    const hours = (Date.parse(expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);
    // Neither the hash nor the connection string is printed.
    const code = normalizeActivationCode(display) as string;
    expect(stdout).not.toContain(hashActivationCode(code));
    expect(stdout).not.toContain('postgres');

    const row = await credentials(a.tenantId, employeeId);
    expect(row.one_time_code_hash).toBe(hashActivationCode(code));
    await expect(consume(a.tenantId, employeeId, code)).resolves.toBe(true);
  });

  it('accepts a phone, honours ACTIVATION_CODE_TTL_HOURS and replaces an earlier code', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-script-phone',
      phone: '+992900990002',
    });
    await putCode(a.tenantId, employeeId, 'EARLIERCODE', 3600, {
      phc: '$scrypt$kept',
      version: 1,
    });

    const { stdout } = await issue('900990002', {
      ACTIVATION_CODE_TTL_HOURS: '2',
    });

    const expiresAt = /Valid until: (\S+)/.exec(stdout)?.[1] ?? '';
    const hours = (Date.parse(expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThanOrEqual(2);
    const row = await credentials(a.tenantId, employeeId);
    expect(row.one_time_code_hash).not.toBe(sha256Hex('EARLIERCODE'));
    // The password stays until the code is used.
    expect(row.password_hash).toBe('$scrypt$kept');
  });

  it('fails for an unknown login without printing a code', async () => {
    await expect(issue('act-nobody')).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('No employee found'),
    });
  });

  it('fails for an archived employee and issues nothing', async () => {
    const { employeeId } = await seedEmployee(a.tenantId, {
      login: 'act-script-archived',
    });
    await asTenant(a.tenantId, (client) =>
      client.query(
        `update employees set status = 'archived', archived_at = now()
         where tenant_id = $1 and id = $2`,
        [a.tenantId, employeeId],
      ),
    );

    await expect(issue('act-script-archived')).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('not active'),
    });
    await expect(credentials(a.tenantId, employeeId)).resolves.toBeUndefined();
  });

  it('fails for an employee of a blocked network', async () => {
    const blocked = await seedTenant('activation-script-blocked');
    await seedEmployee(blocked.tenantId, { login: 'act-script-netblocked' });
    await platformPool().query(
      `update tenants set status = 'blocked' where id = $1`,
      [blocked.tenantId],
    );

    await expect(issue('act-script-netblocked')).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('not active'),
    });
  });

  it('fails without --login', async () => {
    await expect(
      run(process.execPath, [SCRIPT], { env: scriptEnv() }),
    ).rejects.toMatchObject({ code: 1, stdout: '' });
  });
});
