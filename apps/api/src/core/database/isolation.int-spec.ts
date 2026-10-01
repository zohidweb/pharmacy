import {
  appPool,
  closeAll,
  platformPool,
} from '../../../test/integration/connections';
import {
  asTenant,
  seedTenant,
  type SeededTenant,
} from '../../../test/integration/seed';
import { newId } from './ids';

// Behaviour checks of ADR-0013 p. 8 with two tenants: RLS and composite keys under pharmacy_app,
// the narrow registry grants under pharmacy_platform.

let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  a = await seedTenant('iso-a');
  b = await seedTenant('iso-b');
});

afterAll(closeAll);

describe('tenant isolation (ADR-0013 p. 8)', () => {
  it("app: reads and updates of another tenant's rows affect 0 rows", async () => {
    const counts = await asTenant(a.tenantId, async (client) => ({
      visibleStoreTenants: (
        await client.query('select distinct tenant_id from stores')
      ).rows.map((row) => row.tenant_id),
      ownStore: (
        await client.query('select id from stores where id = $1', [a.storeId])
      ).rowCount,
      foreignStore: (
        await client.query('select id from stores where id = $1', [b.storeId])
      ).rowCount,
      foreignStoreUpdate: (
        await client.query("update stores set name = 'x' where id = $1", [
          b.storeId,
        ])
      ).rowCount,
      foreignLegalEntity: (
        await client.query('select id from legal_entities where id = $1', [
          b.legalEntityId,
        ])
      ).rowCount,
      foreignLegalEntityUpdate: (
        await client.query(
          "update legal_entities set name = 'x' where id = $1",
          [b.legalEntityId],
        )
      ).rowCount,
    }));
    expect(counts).toEqual({
      visibleStoreTenants: [a.tenantId],
      ownStore: 1,
      foreignStore: 0,
      foreignStoreUpdate: 0,
      foreignLegalEntity: 0,
      foreignLegalEntityUpdate: 0,
    });
  });

  it('app: insert with another tenant_id violates the policy', async () => {
    await expect(
      asTenant(a.tenantId, (client) =>
        client.query(
          `insert into legal_entities (id, tenant_id, name, tax_id, legal_address)
           values ($1, $2, 'Foreign entity', '111111111', 'Somewhere')`,
          [newId(), b.tenantId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('app: a query without tenant context fails', async () => {
    await expect(
      appPool().query('select id from stores'),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(42704|22P02)$/),
    });
  });

  it('app: sees only its own tenants row and cannot insert tenants', async () => {
    const rows = await asTenant(
      a.tenantId,
      async (client) => (await client.query('select id from tenants')).rows,
    );
    expect(rows).toEqual([{ id: a.tenantId }]);

    await expect(
      asTenant(a.tenantId, (client) =>
        client.query(
          "insert into tenants (id, code, name) values ($1, 'iso-x', 'Intruder')",
          [newId()],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('app: composite FK rejects a store of another tenant in employee_stores', async () => {
    await expect(
      asTenant(a.tenantId, async (client) => {
        const roleId = newId();
        const employeeId = newId();
        await client.query(
          `insert into roles (id, tenant_id, name) values ($1, $2, '{"ru": "Кассир"}')`,
          [roleId, a.tenantId],
        );
        await client.query(
          `insert into employees (id, tenant_id, role_id, login, full_name, store_scope)
           values ($1, $2, $3, 'cashier', 'Test Cashier', 'list')`,
          [employeeId, a.tenantId, roleId],
        );
        await client.query(
          'insert into employee_stores (tenant_id, employee_id, store_id) values ($1, $2, $3)',
          [a.tenantId, employeeId, b.storeId],
        );
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('app: composite FK rejects a legal entity of another tenant in stores', async () => {
    await expect(
      asTenant(a.tenantId, (client) =>
        client.query(
          `insert into stores (id, tenant_id, legal_entity_id, name, code, address, kind)
           values ($1, $2, $3, 'Foreign store', '02', 'Somewhere', 'pharmacy')`,
          [newId(), a.tenantId, b.legalEntityId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('platform: tenant tables are not readable', async () => {
    await expect(
      platformPool().query('select * from roles'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      platformPool().query('select * from employee_credentials'),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('platform: store registry columns are readable, address is not', async () => {
    const { rows } = await platformPool().query<{ id: string }>(
      'select id, name, mode from stores',
    );
    expect(rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([a.storeId, b.storeId]),
    );

    await expect(
      platformPool().query('select address from stores'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('platform: may change store mode only', async () => {
    const client = await platformPool().connect();
    try {
      await client.query('begin');
      const modeUpdate = await client.query(
        "update stores set mode = 'offline' where id = $1",
        [a.storeId],
      );
      expect(modeUpdate.rowCount).toBe(1);
      await expect(
        client.query("update stores set name = 'x' where id = $1", [a.storeId]),
      ).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
