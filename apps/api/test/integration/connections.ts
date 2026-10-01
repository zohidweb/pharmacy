import type { Pool } from 'pg';
import { createPool } from '../../src/core/database/pool';
import { testDatabaseUrls } from './database-urls';

// Lazily created pools on the test database; one pool per role, shared within a Jest worker.
const pools = new Map<string, Pool>();

function poolFor(role: 'app' | 'platform' | 'owner'): Pool {
  let pool = pools.get(role);
  if (!pool) {
    pool = createPool({
      connectionString: testDatabaseUrls(process.env)[role],
      applicationName: `pharmacy-it-${role}`,
      max: 4,
      connectionTimeoutMillis: 5000,
    });
    pools.set(role, pool);
  }
  return pool;
}

export const appPool = (): Pool => poolFor('app');
export const platformPool = (): Pool => poolFor('platform');
export const ownerPool = (): Pool => poolFor('owner');

export async function closeAll(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((pool) => pool.end()));
}
