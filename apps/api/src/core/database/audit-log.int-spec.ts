import type { PoolClient } from 'pg';
import { closeAll, ownerPool } from '../../../test/integration/connections';
import {
  asTenant,
  seedTenant,
  type SeededTenant,
} from '../../../test/integration/seed';
import { newId } from './ids';

// audit_log is append-only at the database level (data model 06; postgres-best-practices
// schema-append-only-audit): pharmacy_app may only select and insert under RLS, and a trigger
// rejects update, delete and truncate for every role that reaches the rows.

let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  a = await seedTenant('audit-a');
  b = await seedTenant('audit-b');
});

afterAll(closeAll);

async function insertAudit(
  client: PoolClient,
  tenantId: string,
  recordedAt?: string,
): Promise<string> {
  const id = newId();
  await client.query(
    `insert into audit_log (tenant_id, id, recorded_at, business_date, correlation_id, action, source)
     values ($1, $2, coalesce($3::timestamptz, now()), current_date, 'it-correlation', 'auth.login', 'cloud')`,
    [tenantId, id, recordedAt ?? null],
  );
  return id;
}

// Runs a statement as the owner in a transaction that is always rolled back.
async function asOwnerRolledBack(sql: string): Promise<void> {
  const client = await ownerPool().connect();
  try {
    await client.query('begin');
    await client.query(sql);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('audit_log (append-only)', () => {
  it('pharmacy_app inserts into the current month and reads its own row', async () => {
    const id = await asTenant(a.tenantId, (client) =>
      insertAudit(client, a.tenantId),
    );
    const rows = await asTenant(
      a.tenantId,
      async (client) =>
        (
          await client.query(
            'select id, action, source from audit_log where id = $1',
            [id],
          )
        ).rows,
    );
    expect(rows).toEqual([{ id, action: 'auth.login', source: 'cloud' }]);
  });

  it.each([
    ['update', "update audit_log set action = 'tampered'"],
    ['delete', 'delete from audit_log'],
  ])('pharmacy_app %s is rejected with 42501', async (_, sql) => {
    await expect(
      asTenant(a.tenantId, async (client) => {
        await insertAudit(client, a.tenantId);
        await client.query(sql);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    ['update', "update pharmacy.%I set action = 'tampered' where id = %L"],
    ['delete', 'delete from pharmacy.%I where id = %L'],
  ])(
    'the trigger rejects %s of a row in its partition',
    async (_, template) => {
      // pharmacy_app is stopped by the missing grants already. The owner reaches the row through
      // the partition itself (RLS is defined on the parent), so only the trigger cloned from the
      // parent stands in the way.
      const { id, partition } = await asTenant(a.tenantId, async (client) => {
        const insertedId = await insertAudit(client, a.tenantId);
        const { rows } = await client.query<{ partition: string }>(
          'select tableoid::regclass::text as partition from audit_log where id = $1',
          [insertedId],
        );
        return { id: insertedId, partition: rows[0].partition };
      });
      const { rows } = await ownerPool().query<{ sql: string }>(
        'select format($1, $2::text, $3::text) as sql',
        [template, partition.replace(/^pharmacy\./, ''), id],
      );
      await expect(asOwnerRolledBack(rows[0].sql)).rejects.toMatchObject({
        code: '42501',
        message: /append-only/,
      });
    },
  );

  it('the trigger rejects truncate of the table', async () => {
    await expect(
      asOwnerRolledBack('truncate pharmacy.audit_log'),
    ).rejects.toMatchObject({ code: '42501', message: /append-only/ });
  });

  it('an insert outside the created partitions fails', async () => {
    await expect(
      asTenant(a.tenantId, (client) =>
        insertAudit(client, a.tenantId, '2031-01-01T00:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: '23514', message: /no partition/ });
  });

  it("another tenant's rows are not visible and cannot be written", async () => {
    const foreignId = await asTenant(b.tenantId, (client) =>
      insertAudit(client, b.tenantId),
    );
    const visible = await asTenant(
      a.tenantId,
      async (client) =>
        (
          await client.query('select id from audit_log where id = $1', [
            foreignId,
          ])
        ).rowCount,
    );
    expect(visible).toBe(0);

    await expect(
      asTenant(a.tenantId, (client) => insertAudit(client, b.tenantId)),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
