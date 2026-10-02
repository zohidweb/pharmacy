import { createClient } from 'redis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// The only Redis client of the API (ADR-0008); it exists in cloud mode only. Created here so that
// its type is the one createClient() actually returns (the generic default does not match it).
export function createRedisClient(url: string) {
  return createClient({ url });
}

export type RedisClient = ReturnType<typeof createRedisClient>;
