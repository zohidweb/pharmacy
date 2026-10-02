import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { REDIS_CLIENT, type RedisClient } from '../../core/redis/redis.tokens';

// The record type is not exported from the package root of @nestjs/throttler 6.
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

// One atomic step per request (KEYS: hits, block; ARGV: ttl ms, limit, block ms), fixed window:
// - while the block key lives, the request is blocked and not counted;
// - otherwise INCR the hits; the first hit (or a key that lost its expiry) gets PEXPIRE ttl;
// - over the limit, the block key is set for blockDuration and the hits are dropped, so a fresh
//   window starts once the block ends (as the in-memory storage of @nestjs/throttler does).
// Returns { totalHits, hits ttl ms, blocked 0|1, block ttl ms }.
const INCREMENT_SCRIPT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, block = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local blockLeft = redis.call('PTTL', blockKey)
if blockLeft > 0 then
  return { limit + 1, blockLeft, 1, blockLeft }
end
local hits = redis.call('INCR', hitsKey)
local hitsLeft = redis.call('PTTL', hitsKey)
if hits == 1 or hitsLeft < 0 then
  redis.call('PEXPIRE', hitsKey, ttl)
  hitsLeft = ttl
end
if hits > limit then
  if block > 0 then
    redis.call('SET', blockKey, '1', 'PX', block)
    redis.call('DEL', hitsKey)
    return { hits, block, 1, block }
  end
  return { hits, hitsLeft, 1, hitsLeft }
end
return { hits, hitsLeft, 0, 0 }
`;

const KEY_PREFIX = 'throttle';

const toSeconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

function parseReply(reply: unknown): [number, number, number, number] {
  if (
    !Array.isArray(reply) ||
    reply.length !== 4 ||
    !reply.every((item) => typeof item === 'number')
  ) {
    throw new Error('Unexpected throttler script reply');
  }
  return reply as [number, number, number, number];
}

// ThrottlerStorage of @nestjs/throttler 6.7 on node-redis (the API's only Redis client, ADR-0008),
// shared by all API instances. ttl and blockDuration arrive in milliseconds; timeToExpire and
// timeToBlockExpire are returned in seconds (Retry-After). Keys hold no personal data: the guard
// passes a SHA-256 of the route and the tracker.
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${KEY_PREFIX}:${throttlerName}:${key}`;
    const reply = await this.redis.eval(INCREMENT_SCRIPT, {
      keys: [`${base}:hits`, `${base}:block`],
      arguments: [String(ttl), String(limit), String(blockDuration)],
    });
    const [totalHits, expireMs, blocked, blockMs] = parseReply(reply);
    return {
      totalHits,
      timeToExpire: toSeconds(expireMs),
      isBlocked: blocked === 1,
      timeToBlockExpire: blocked === 1 ? toSeconds(blockMs) : 0,
    };
  }
}
