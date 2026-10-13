import { ClientOfflineError, createClient } from 'redis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// While Redis is unreachable and the client reconnects, a command is rejected at once instead of
// waiting in the offline queue: sessions fail closed to a guest and writes answer an error without
// holding the request. A connection attempt gives up after CONNECT_TIMEOUT_MS and is retried.
const CONNECT_TIMEOUT_MS = 5_000;

// The only Redis client of the API (ADR-0008); it exists in cloud mode only. Created here so that
// its type is the one createClient() actually returns (the generic default does not match it).
export function createRedisClient(url: string) {
  return createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: CONNECT_TIMEOUT_MS },
  });
}

export type RedisClient = ReturnType<typeof createRedisClient>;

/**
 * A MULTI of a client that is ready. The offline queue setting covers single commands only:
 * node-redis holds a MULTI of a reconnecting client until the reconnect ends, so it is refused
 * here at once, like a single command.
 */
export function readyMulti(client: RedisClient) {
  if (!client.isReady) throw new ClientOfflineError();
  return client.multi();
}
