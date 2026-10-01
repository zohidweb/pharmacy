import { sql, type Transaction } from 'kysely';
import { testDatabaseUrls } from '../../../../test/integration/database-urls';
import { closeAll } from '../../../../test/integration/connections';
import {
  seedTenant,
  type SeededTenant,
} from '../../../../test/integration/seed';
import type { DB } from '../db.generated';
import type { DatabaseSettings } from '../database-settings';
import { newId } from '../ids';
import { PlatformDatabase, type PlatformActor } from './platform-database';

// The cross-tenant path of ADR-0013 p. 7: pharmacy_platform, a mandatory actor, the store registry
// only. The pool has a single connection, so consecutive transactions reuse it (ADR-0013 p. 8).

const settings = (): DatabaseSettings => ({
  url: testDatabaseUrls(process.env).platform,
  poolMax: 1,
  statementTimeoutMs: 200,
  lockTimeoutMs: 100,
  connectionTimeoutMs: 2000,
});

interface SessionState {
  actor: string;
  statementTimeout: string;
  lockTimeout: string;
  backendPid: number;
}

async function sessionState(trx: Transaction<DB>): Promise<SessionState> {
  const { rows } = await sql<SessionState>`
    select current_setting('app.actor') as actor,
           current_setting('statement_timeout') as statement_timeout,
           current_setting('lock_timeout') as lock_timeout,
           pg_backend_pid() as backend_pid`.execute(trx);
  return rows[0];
}

let a: SeededTenant;
let b: SeededTenant;
let db: PlatformDatabase;

beforeAll(async () => {
  a = await seedTenant('pdb-a');
  b = await seedTenant('pdb-b');
  db = new PlatformDatabase(settings());
});

afterAll(async () => {
  await db.onModuleDestroy();
  await closeAll();
});

describe('PlatformDatabase.platformTransaction', () => {
  it('sets app.actor for an operator', async () => {
    const operatorId = newId();
    const state = await db.platformTransaction(
      { kind: 'operator', operatorId },
      sessionState,
    );
    expect(state).toMatchObject({
      actor: `operator:${operatorId}`,
      statementTimeout: '200ms',
      lockTimeout: '100ms',
    });
  });

  it('sets app.actor for a system job', async () => {
    const state = await db.platformTransaction(
      { kind: 'system', job: 'billing.recalc-01' },
      sessionState,
    );
    expect(state.actor).toBe('system:billing.recalc-01');
  });

  it('rejects a missing or malformed actor', async () => {
    const work = jest.fn();
    const invalid: unknown[] = [
      undefined,
      null,
      {},
      { kind: 'operator', operatorId: 'x' },
      { kind: 'operator' },
      { kind: 'system', job: 'Bad Job' },
      { kind: 'system', job: '' },
      { kind: 'system', job: 'a'.repeat(65) },
      { kind: 'tenant', tenantId: a.tenantId },
    ];
    for (const actor of invalid) {
      await expect(
        db.platformTransaction(actor as PlatformActor, work),
      ).rejects.toThrow('Invalid platform actor');
    }
    expect(work).not.toHaveBeenCalled();
  });

  it('reads the store registry and is denied tenant tables', async () => {
    const actor: PlatformActor = { kind: 'system', job: 'registry-check' };
    const stores = await db.platformTransaction(actor, (trx) =>
      trx.selectFrom('stores').select(['id', 'tenantId', 'mode']).execute(),
    );
    expect(stores.map((store) => store.id)).toEqual(
      expect.arrayContaining([a.storeId, b.storeId]),
    );

    await expect(
      db.platformTransaction(actor, (trx) =>
        trx.selectFrom('roles').selectAll().execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('platform: does not leak app.actor to the next transaction on a reused connection', async () => {
    const operatorId = newId();
    const first = await db.platformTransaction(
      { kind: 'operator', operatorId },
      sessionState,
    );
    const second = await db.platformTransaction(
      { kind: 'system', job: 'next-job' },
      sessionState,
    );
    expect(second.backendPid).toBe(first.backendPid);
    expect(first.actor).toBe(`operator:${operatorId}`);
    expect(second.actor).toBe('system:next-job');
  });

  it('rolls back when work throws', async () => {
    const actor: PlatformActor = { kind: 'system', job: 'rollback-check' };
    await expect(
      db.platformTransaction(actor, async (trx) => {
        await trx
          .updateTable('stores')
          .set({ mode: 'offline' })
          .where('id', '=', a.storeId)
          .execute();
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');

    const store = await db.platformTransaction(actor, (trx) =>
      trx
        .selectFrom('stores')
        .select('mode')
        .where('id', '=', a.storeId)
        .executeTakeFirstOrThrow(),
    );
    expect(store.mode).toBe('online');
  });
});
