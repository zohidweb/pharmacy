import type { RedisClient } from '../redis/redis.tokens';
import {
  PermissionsVersionCache,
  SessionStore,
  type SessionLookup,
  type SessionPatch,
  type SessionRecord,
} from './session-store';

const sessionKey = (sessionId: string): string => `sess:${sessionId}`;
const employeeSessionsKey = (tenantId: string, employeeId: string): string =>
  `emp-sess:${tenantId}:${employeeId}`;
const versionKey = (tenantId: string, employeeId: string): string =>
  `pv:${tenantId}:${employeeId}`;

const PATCHABLE_FIELDS = [
  'permissions',
  'permissionsVersion',
  'storeScope',
  'currentStoreId',
  'locale',
] as const;

// A cached version is only a hint: a missing key means "read it from the database", so a bounded
// lifetime caps the damage if a post-commit write of a newer version was lost.
const PERMISSIONS_VERSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const MAX_UPDATE_ATTEMPTS = 5;

// Overwrites the key only if it still holds the value that was read, keeping its TTL.
const COMPARE_AND_SET = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
  return 1
end
return 0`;

// Idle lifetime in ms, capped by the absolute expiry; null when the session has already expired.
function lifetimeMs(idleTtlSeconds: number, absoluteExpiresAt: string): number | null {
  const untilAbsolute = Date.parse(absoluteExpiresAt) - Date.now();
  const ms = Math.min(idleTtlSeconds * 1000, untilAbsolute);
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms) : null;
}

function parseRecord(raw: string | null): SessionRecord | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' ? (value as SessionRecord) : null;
  } catch {
    return null;
  }
}

function parseVersion(raw: string | null): number | null {
  if (raw === null) return null;
  const version = Number(raw);
  return Number.isSafeInteger(version) ? version : null;
}

// Cloud implementation of SessionStore (node-redis). Keys: sess:<id> (JSON, PX = idle lifetime
// capped by the absolute expiry), emp-sess:<tid>:<eid> (set of the employee's session ids).
export class RedisSessionStore extends SessionStore {
  constructor(private readonly redis: RedisClient) {
    super();
  }

  async create(record: SessionRecord): Promise<void> {
    const ttl = lifetimeMs(record.idleTtlSeconds, record.absoluteExpiresAt);
    if (ttl === null) return;
    const setKey = employeeSessionsKey(record.tenantId, record.employeeId);
    const absoluteMs = Math.ceil(Date.parse(record.absoluteExpiresAt) - Date.now());
    await this.redis
      .multi()
      .set(sessionKey(record.sessionId), JSON.stringify(record), {
        expiration: { type: 'PX', value: ttl },
      })
      .sAdd(setKey, record.sessionId)
      // The set lives at least as long as its longest-lived session: NX sets the first expiry,
      // GT only ever extends it (GT alone never applies to a key without an expiry).
      .pExpire(setKey, absoluteMs, 'NX')
      .pExpire(setKey, absoluteMs, 'GT')
      .exec();
  }

  async lookup(sessionId: string, tenantId: string, employeeId: string): Promise<SessionLookup> {
    const [rawSession, rawVersion] = await this.redis.mGet([
      sessionKey(sessionId),
      versionKey(tenantId, employeeId),
    ]);
    const session = parseRecord(rawSession as string | null);
    if (
      session === null ||
      session.sessionId !== sessionId ||
      session.tenantId !== tenantId ||
      session.employeeId !== employeeId
    ) {
      return { session: null, permissionsVersion: null };
    }
    return { session, permissionsVersion: parseVersion(rawVersion as string | null) };
  }

  async update(sessionId: string, patch: SessionPatch): Promise<void> {
    const key = sessionKey(sessionId);
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const raw = await this.redis.get(key);
      const record = parseRecord(raw);
      if (raw === null || record === null) return; // gone or expired: nothing to update
      const next: Record<string, unknown> = { ...record };
      for (const field of PATCHABLE_FIELDS) {
        if (patch[field] !== undefined) next[field] = patch[field];
      }
      const swapped = await this.redis.eval(COMPARE_AND_SET, {
        keys: [key],
        arguments: [raw, JSON.stringify(next)],
      });
      if (swapped === 1) return;
    }
    throw new Error('Session update lost the race too many times');
  }

  async touch(sessionId: string, idleTtlSeconds: number): Promise<void> {
    const key = sessionKey(sessionId);
    const record = parseRecord(await this.redis.get(key));
    if (record === null) return;
    const ttl = lifetimeMs(idleTtlSeconds, record.absoluteExpiresAt);
    if (ttl === null) {
      await this.destroy(sessionId);
      return;
    }
    await this.redis.pExpire(key, ttl);
  }

  async destroy(sessionId: string): Promise<void> {
    const key = sessionKey(sessionId);
    const record = parseRecord(await this.redis.get(key));
    const multi = this.redis.multi().del(key);
    if (record !== null) {
      multi.sRem(employeeSessionsKey(record.tenantId, record.employeeId), sessionId);
    }
    await multi.exec();
  }

  async destroyAllFor(
    tenantId: string,
    employeeId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    const setKey = employeeSessionsKey(tenantId, employeeId);
    const ids = (await this.redis.sMembers(setKey)).filter((id) => id !== exceptSessionId);
    if (ids.length === 0) return;
    // Removing only the listed ids keeps the excepted session and any session created meanwhile.
    await this.redis.multi().del(ids.map(sessionKey)).sRem(setKey, ids).exec();
  }
}

export class RedisPermissionsVersionCache extends PermissionsVersionCache {
  constructor(private readonly redis: RedisClient) {
    super();
  }

  async get(tenantId: string, employeeId: string): Promise<number | null> {
    return parseVersion(await this.redis.get(versionKey(tenantId, employeeId)));
  }

  async set(tenantId: string, employeeId: string, version: number): Promise<void> {
    await this.redis.set(versionKey(tenantId, employeeId), String(version), {
      expiration: { type: 'EX', value: PERMISSIONS_VERSION_TTL_SECONDS },
    });
  }

  async setIfAbsent(tenantId: string, employeeId: string, version: number): Promise<void> {
    // SET ... NX EX: atomic, a cached value always wins over this (possibly stale) one.
    await this.redis.set(versionKey(tenantId, employeeId), String(version), {
      condition: 'NX',
      expiration: { type: 'EX', value: PERMISSIONS_VERSION_TTL_SECONDS },
    });
  }
}
