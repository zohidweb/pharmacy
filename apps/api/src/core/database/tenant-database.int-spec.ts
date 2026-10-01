import { sql } from 'kysely';
import { testDatabaseUrls } from '../../../test/integration/database-urls';
import { closeAll } from '../../../test/integration/connections';
import { seedTenant, type SeededTenant } from '../../../test/integration/seed';
import {
  runWithContext,
  TenantContextMissingError,
} from '../../common/context/request-context';
import type { DatabaseSettings } from './database-settings';
import { newId } from './ids';
import { TenantDatabase, type TenantTransaction } from './tenant-database';

// Behaviour of the only tenant data path (ADR-0006 rules 1, 3, 4, 6; ADR-0013 p. 8). The pool has
// a single connection, so consecutive transactions are guaranteed to reuse the same connection.

const settings = (): DatabaseSettings => ({
  url: testDatabaseUrls(process.env).app,
  poolMax: 1,
  statementTimeoutMs: 200,
  lockTimeoutMs: 100,
  connectionTimeoutMs: 2000,
});

interface SessionState {
  tenantId: string;
  statementTimeout: string;
  lockTimeout: string;
  backendPid: number;
}

async function sessionState(trx: TenantTransaction): Promise<SessionState> {
  const { rows } = await sql<SessionState>`
    select current_setting('app.tenant_id') as tenant_id,
           current_setting('statement_timeout') as statement_timeout,
           current_setting('lock_timeout') as lock_timeout,
           pg_backend_pid() as backend_pid`.execute(trx);
  return rows[0];
}

async function insertRole(
  trx: TenantTransaction,
  tenantId: string,
): Promise<string> {
  const roleId = newId();
  await trx
    .insertInto('roles')
    .values({ tenantId, id: roleId, name: { ru: 'Кассир' } })
    .execute();
  return roleId;
}

let a: SeededTenant;
let b: SeededTenant;
let db: TenantDatabase;

beforeAll(async () => {
  a = await seedTenant('tdb-a');
  b = await seedTenant('tdb-b');
  db = new TenantDatabase(settings());
});

afterAll(async () => {
  await db.onModuleDestroy();
  await closeAll();
});

describe('TenantDatabase.withTenant', () => {
  it('sets app.tenant_id and timeouts as the first statements', async () => {
    const state = await db.withTenant(a.tenantId, sessionState);
    expect(state).toMatchObject({
      tenantId: a.tenantId,
      statementTimeout: '200ms',
      lockTimeout: '100ms',
    });
  });

  it('returns camelCase rows and int8 as bigint', async () => {
    const employee = await db.withTenant(a.tenantId, async (trx) => {
      const roleId = await insertRole(trx, a.tenantId);
      await trx
        .insertInto('employees')
        .values({
          tenantId: a.tenantId,
          id: newId(),
          roleId,
          login: 'camel-case',
          fullName: 'Test Employee',
          storeScope: 'all',
        })
        .execute();
      return trx
        .selectFrom('employees')
        .select(['fullName', 'permissionsVersion'])
        .where('login', '=', 'camel-case')
        .executeTakeFirstOrThrow();
    });
    expect(employee).toEqual({
      fullName: 'Test Employee',
      permissionsVersion: 1n,
    });
    expect(typeof employee.permissionsVersion).toBe('bigint');
  });

  it('sees only the rows of its tenant', async () => {
    const stores = await db.withTenant(a.tenantId, (trx) =>
      trx.selectFrom('stores').select(['id', 'tenantId']).execute(),
    );
    const ids = stores.map((store) => store.id);
    expect(ids).toContain(a.storeId);
    expect(ids).not.toContain(b.storeId);
    expect(new Set(stores.map((store) => store.tenantId))).toEqual(
      new Set([a.tenantId]),
    );
  });

  it('rolls back and releases the connection when work throws', async () => {
    let roleId = '';
    await expect(
      db.withTenant(a.tenantId, async (trx) => {
        roleId = await insertRole(trx, a.tenantId);
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');

    // The single pooled connection is free again, and the insert did not survive.
    const role = await db.withTenant(a.tenantId, (trx) =>
      trx
        .selectFrom('roles')
        .select('id')
        .where('id', '=', roleId)
        .executeTakeFirst(),
    );
    expect(roleId).not.toBe('');
    expect(role).toBeUndefined();
  });

  it('does not leak the tenant to the next transaction on a reused connection', async () => {
    const first = await db.withTenant(a.tenantId, sessionState);
    const second = await db.withTenant(b.tenantId, async (trx) => ({
      state: await sessionState(trx),
      storeTenants: (
        await trx.selectFrom('stores').select('tenantId').execute()
      ).map((store) => store.tenantId),
    }));

    expect(second.state.backendPid).toBe(first.backendPid);
    expect(second.state.tenantId).toBe(b.tenantId);
    expect(second.storeTenants).toContain(b.tenantId);
    expect(second.storeTenants).not.toContain(a.tenantId);
  });

  it('applies statement_timeout', async () => {
    await expect(
      db.withTenant(a.tenantId, (trx) => sql`select pg_sleep(1)`.execute(trx)),
    ).rejects.toMatchObject({ code: '57014' });

    // The connection is usable after the cancelled statement.
    const state = await db.withTenant(a.tenantId, sessionState);
    expect(state.tenantId).toBe(a.tenantId);
  });

  it('rejects an invalid tenant id before touching the database', async () => {
    // An unreachable database: any connection attempt would fail with a different error.
    const offline = new TenantDatabase({
      ...settings(),
      url: 'postgresql://nobody@127.0.0.1:1/none',
    });
    const work = jest.fn();
    try {
      for (const invalid of [
        'x',
        '',
        `${a.tenantId}'; reset all; --`,
        undefined as unknown as string,
      ]) {
        await expect(offline.withTenant(invalid, work)).rejects.toThrow(
          'Invalid tenant id',
        );
      }
      expect(work).not.toHaveBeenCalled();
    } finally {
      await offline.onModuleDestroy();
    }
  });
});

describe('TenantDatabase.tenantTransaction', () => {
  it('tenantTransaction uses the tenant from the request context and fails without it', async () => {
    const tenantId = await runWithContext(
      { correlationId: 'corr-tdb-0001', tenantId: b.tenantId },
      () =>
        db.tenantTransaction(async (trx) => (await sessionState(trx)).tenantId),
    );
    expect(tenantId).toBe(b.tenantId);

    const work = jest.fn();
    await expect(db.tenantTransaction(work)).rejects.toThrow(
      TenantContextMissingError,
    );
    await expect(
      runWithContext({ correlationId: 'corr-tdb-0002' }, () =>
        db.tenantTransaction(work),
      ),
    ).rejects.toThrow(TenantContextMissingError);
    expect(work).not.toHaveBeenCalled();
  });
});

describe('TenantDatabase.onModuleDestroy', () => {
  it('can be called more than once', async () => {
    const other = new TenantDatabase(settings());
    await other.withTenant(a.tenantId, sessionState);
    await other.onModuleDestroy();
    await expect(other.onModuleDestroy()).resolves.toBeUndefined();
  });
});
