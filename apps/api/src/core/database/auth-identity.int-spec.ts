import { appPool, closeAll } from '../../../test/integration/connections';
import {
  seedEmployee,
  seedTenant,
  type SeededEmployee,
  type SeededTenant,
} from '../../../test/integration/seed';

// Global login identifiers and the pre-context resolver resolve_login (ADR-0013, amendment
// 2026-10-02; ADR-0008, amendment 2026-10-02): login, phone and e-mail are unique across all
// tenants, so a single identifier resolves to exactly one tenant before the tenant context exists.

let a: SeededTenant;
let b: SeededTenant;
let zarina: SeededEmployee;

beforeAll(async () => {
  a = await seedTenant('ident-a');
  b = await seedTenant('ident-b');
  zarina = await seedEmployee(a.tenantId, {
    login: 'Zarina',
    phone: '+992931234567',
    email: 'Z@X.tj',
  });
});

afterAll(closeAll);

async function resolveLogin(kind: string, value: string) {
  const { rows } = await appPool().query<{
    tenant_id: string;
    employee_id: string;
    tenant_status: string;
  }>(
    'select tenant_id, employee_id, tenant_status from resolve_login($1, $2)',
    [kind, value],
  );
  return rows;
}

describe('global login identifiers', () => {
  it.each([
    ['login in another case', { login: 'ZARINA' }],
    ['phone', { login: 'zarina-phone', phone: '+992931234567' }],
    ['e-mail in another case', { login: 'zarina-email', email: 'z@x.TJ' }],
  ])('another tenant cannot take the same %s', async (_, input) => {
    await expect(seedEmployee(b.tenantId, input)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('phone must be in E.164', async () => {
    await expect(
      seedEmployee(b.tenantId, { login: 'bad-phone', phone: '992931234568' }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('resolve_login (pharmacy_app, no tenant context)', () => {
  it.each([
    ['login', 'zarina'],
    ['phone', '+992931234567'],
    ['email', 'z@x.tj'],
  ])('finds the employee by %s', async (kind, value) => {
    expect(await resolveLogin(kind, value)).toEqual([
      {
        tenant_id: a.tenantId,
        employee_id: zarina.employeeId,
        tenant_status: 'active',
      },
    ]);
  });

  it.each([
    ['login', 'nobody'],
    ['phone', '+992000000000'],
    ['email', 'nobody@x.tj'],
    ['code', 'ident-a'],
  ])('returns no rows for an unknown %s', async (kind, value) => {
    expect(await resolveLogin(kind, value)).toEqual([]);
  });

  it('pharmacy_app cannot read employees directly without a tenant context', async () => {
    // Fail-closed tenant filter: no context is an error, never an unfiltered read.
    await expect(
      appPool().query('select id from employees'),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(42704|22P02)$/),
    });
  });
});
