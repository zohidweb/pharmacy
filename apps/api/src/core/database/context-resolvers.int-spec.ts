import {
  appPool,
  closeAll,
  platformPool,
} from '../../../test/integration/connections';
import { testDatabaseUrls } from '../../../test/integration/database-urls';
import {
  seedEmployee,
  seedTenant,
  type SeededEmployee,
  type SeededTenant,
} from '../../../test/integration/seed';
import { ContextResolvers } from './index';

// ContextResolvers on the real schema as pharmacy_app without a tenant context: resolve_login
// maps a normalized identifier to the tenant, the employee and the tenant status — nothing else.

let resolvers: ContextResolvers;
let a: SeededTenant;
let b: SeededTenant;
let farida: SeededEmployee;
let blockedOwner: SeededEmployee;

beforeAll(async () => {
  resolvers = new ContextResolvers({
    url: testDatabaseUrls(process.env).app,
    poolMax: 10,
    statementTimeoutMs: 5000,
    lockTimeoutMs: 2000,
    connectionTimeoutMs: 5000,
  });
  a = await seedTenant('resolver-a');
  b = await seedTenant('resolver-b');
  farida = await seedEmployee(a.tenantId, {
    login: 'Farida.R',
    phone: '+992900000101',
    email: 'Farida@Example.tj',
  });
  blockedOwner = await seedEmployee(b.tenantId, { login: 'resolver-blocked' });
  await platformPool().query(
    "update tenants set status = 'blocked' where id = $1",
    [b.tenantId],
  );
});

afterAll(async () => {
  await resolvers.onModuleDestroy();
  await closeAll();
});

describe('ContextResolvers.resolveLogin', () => {
  it.each([
    ['login', 'farida.r'],
    ['phone', '+992900000101'],
    ['email', 'farida@example.tj'],
  ] as const)('resolves by %s', async (kind, value) => {
    await expect(resolvers.resolveLogin(kind, value)).resolves.toEqual({
      tenantId: a.tenantId,
      employeeId: farida.employeeId,
      tenantStatus: 'active',
    });
  });

  it('compares the value as given (callers lower-case it)', async () => {
    await expect(
      resolvers.resolveLogin('login', 'Farida.R'),
    ).resolves.toBeNull();
  });

  it('returns null for an unknown identifier', async () => {
    await expect(
      resolvers.resolveLogin('login', 'nobody-here'),
    ).resolves.toBeNull();
  });

  it('does not mix kinds: a login value is not looked up as an e-mail', async () => {
    await expect(
      resolvers.resolveLogin('email', 'farida.r'),
    ).resolves.toBeNull();
  });

  it('reports the tenant status of a blocked network', async () => {
    await expect(
      resolvers.resolveLogin('login', 'resolver-blocked'),
    ).resolves.toEqual({
      tenantId: b.tenantId,
      employeeId: blockedOwner.employeeId,
      tenantStatus: 'blocked',
    });
  });

  it('rejects an unknown kind before any database call', async () => {
    await expect(resolvers.resolveLogin('code' as never, 'x')).rejects.toThrow(
      'Invalid login kind',
    );
  });

  it('treats input as a parameter, never as SQL', async () => {
    await expect(
      resolvers.resolveLogin('login', "' or true --"),
    ).resolves.toBeNull();
  });

  it('uses its own pool of at most 2 connections named api-resolver and closes it on destroy', async () => {
    const own = new ContextResolvers({
      url: testDatabaseUrls(process.env).app,
      poolMax: 10,
      statementTimeoutMs: 5000,
      lockTimeoutMs: 2000,
      connectionTimeoutMs: 5000,
    });
    // pg_stat_activity is read as the same role (pharmacy_app), so application_name is visible.
    const resolverConnections = async (): Promise<number> => {
      const { rows } = await appPool().query<{ count: string }>(
        `select count(*)::text as count from pg_stat_activity
          where datname = current_database() and application_name = 'api-resolver'`,
      );
      return Number(rows[0].count);
    };
    const before = await resolverConnections();

    await Promise.all(
      Array.from({ length: 6 }, () => own.resolveLogin('login', 'farida.r')),
    );
    const open = (await resolverConnections()) - before;
    expect(open).toBeGreaterThanOrEqual(1);
    expect(open).toBeLessThanOrEqual(2);

    await own.onModuleDestroy();
    await expect(own.resolveLogin('login', 'farida.r')).rejects.toThrow(
      'ContextResolvers is closed',
    );
  });
});
