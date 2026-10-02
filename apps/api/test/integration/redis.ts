import { createRedisClient, type RedisClient } from '../../src/core/redis/redis.tokens';

const TEST_REDIS_DATABASE = 15;

// Maps the dev REDIS_URL onto logical database 15, so tests never touch the dev data (database 0).
export function testRedisUrl(env: NodeJS.ProcessEnv): string {
  const value = env['REDIS_URL'];
  if (!value) throw new Error('REDIS_URL is required to run integration tests');
  const url = new URL(value);
  url.pathname = `/${TEST_REDIS_DATABASE}`;
  return url.toString();
}

// Connected client on the test database. The caller closes it.
export async function createTestRedis(): Promise<RedisClient> {
  const client = createRedisClient(testRedisUrl(process.env));
  client.on('error', () => undefined);
  await client.connect();
  return client;
}

// Empties database 15 only (the URL is always forced to it).
export async function flushTestRedis(client: RedisClient): Promise<void> {
  await client.flushDb();
}
