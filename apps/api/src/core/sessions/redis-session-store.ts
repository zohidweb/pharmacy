import { type RedisClient, readyMulti } from '../redis/redis.tokens';
import {
  PermissionsVersionCache,
  SessionStore,
  type SessionLookup,
  type SessionPatch,
  type SessionRecord,
} from './session-store';

const SESSION_PREFIX = 'sess:';
const EMPLOYEE_SESSIONS_PREFIX = 'emp-sess:';

const sessionKey = (sessionId: string): string => `${SESSION_PREFIX}${sessionId}`;
const employeeSessionsKey = (tenantId: string, employeeId: string): string =>
  `${EMPLOYEE_SESSIONS_PREFIX}${tenantId}:${employeeId}`;
const versionKey = (tenantId: string, employeeId: string): string =>
  `pv:${tenantId}:${employeeId}`;
const terminalSessionKey = (tenantId: string, terminalId: string): string =>
  `term-sess:${tenantId}:${terminalId}`;
const terminalRevokedKey = (tenantId: string, terminalId: string): string =>
  `term-rev:${tenantId}:${terminalId}`;
const tenantBlockedKey = (tenantId: string): string => `tenant-blocked:${tenantId}`;

const PATCHABLE_FIELDS = [
  'permissions',
  'permissionsVersion',
  'storeScope',
  'currentStoreId',
  'locale',
  'authenticatedAt',
] as const;

// A cached version is only a hint: a missing key means "read it from the database". The lifetime
// is short (minutes) so that a lost post-commit write of a newer version costs at most this much
// staleness: the key expires, the next request reloads from the database and refills it.
export const PERMISSIONS_VERSION_TTL_SECONDS = 300;

const MAX_UPDATE_ATTEMPTS = 5;

// Overwrites the key only if it still holds the value that was read, keeping its TTL.
const COMPARE_AND_SET = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
  return 1
end
return 0`;

// Set if greater: writes only when the key is missing or holds a lower version, and refreshes the
// lifetime whenever it writes. Atomic, so concurrent writers end at the greatest version.
// A stored value that is not a whole number (as parseVersion reads it) is treated as missing.
const SET_IF_GREATER = `
local stored = redis.call('GET', KEYS[1])
local current = nil
if stored and string.match(stored, '^%d+$') then
  current = tonumber(stored)
end
if current == nil or current < tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0`;

// One PIN session per terminal, kept exact: the session the terminal's link names is removed
// (with its entry in its employee's set) and the link moves to the new session, or is deleted, in
// one atomic step, so overlapping PIN sign-ins on a terminal leave only the last one alive and
// linked. The keys of the linked session are only known once the link is read, so they are built
// here from the prefixes (a single Redis node; no cluster slots to declare).
// KEYS[1] the link; ARGV: session prefix, employee set prefix, new session id ('' deletes the
// link), link lifetime in ms.
const SWAP_TERMINAL_SESSION = `
local previous = redis.call('GET', KEYS[1])
if previous and previous ~= ARGV[3] then
  local key = ARGV[1] .. previous
  local raw = redis.call('GET', key)
  redis.call('DEL', key)
  if raw then
    local ok, record = pcall(cjson.decode, raw)
    if ok and type(record) == 'table' and type(record.tenantId) == 'string'
        and type(record.employeeId) == 'string' then
      redis.call('SREM', ARGV[2] .. record.tenantId .. ':' .. record.employeeId, previous)
    end
  end
end
if ARGV[3] == '' then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
end
return 1`;

// Drops the ids of sessions that have expired from an employee's set (KEYS[1]; ARGV[1] the session
// key prefix): a session ends by expiry without a destroy, and the set of an employee who signs in
// every day would otherwise only grow. The session keys are built here from the prefix (a single
// Redis node; no cluster slots to declare), as in SWAP_TERMINAL_SESSION.
const PRUNE_EXPIRED = `
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  if redis.call('EXISTS', ARGV[1] .. id) == 0 then
    redis.call('SREM', KEYS[1], id)
  end
end
return 1`;

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
// capped by the absolute expiry), emp-sess:<tid>:<eid> (set of the employee's session ids),
// term-sess:<tid>:<terminal> (the terminal's PIN session id), term-rev:<tid>:<terminal> (revoked).
export class RedisSessionStore extends SessionStore {
  constructor(private readonly redis: RedisClient) {
    super();
  }

  async create(record: SessionRecord): Promise<void> {
    const ttl = lifetimeMs(record.idleTtlSeconds, record.absoluteExpiresAt);
    // Never silently: the caller would hand out a cookie of a session that does not exist.
    if (ttl === null) throw new Error('The session to store has already expired');
    const setKey = employeeSessionsKey(record.tenantId, record.employeeId);
    const absoluteMs = Math.ceil(Date.parse(record.absoluteExpiresAt) - Date.now());
    const multi = readyMulti(this.redis);
    if (record.terminalId !== null) {
      multi.eval(SWAP_TERMINAL_SESSION, {
        keys: [terminalSessionKey(record.tenantId, record.terminalId)],
        arguments: [
          SESSION_PREFIX,
          EMPLOYEE_SESSIONS_PREFIX,
          record.sessionId,
          String(absoluteMs),
        ],
      });
    }
    multi.eval(PRUNE_EXPIRED, { keys: [setKey], arguments: [SESSION_PREFIX] });
    await multi
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
    const [rawSession, rawVersion, rawBlocked] = await this.redis.mGet([
      sessionKey(sessionId),
      versionKey(tenantId, employeeId),
      tenantBlockedKey(tenantId),
    ]);
    const tenantBlocked = rawBlocked !== null;
    const session = parseRecord(rawSession as string | null);
    if (
      session === null ||
      session.sessionId !== sessionId ||
      session.tenantId !== tenantId ||
      session.employeeId !== employeeId
    ) {
      return { session: null, permissionsVersion: null, terminalRevoked: false, tenantBlocked };
    }
    // A second round trip only for PIN sessions: the terminal is known after the record is read.
    const terminalRevoked =
      typeof session.terminalId === 'string' &&
      (await this.redis.exists(terminalRevokedKey(tenantId, session.terminalId))) === 1;
    return {
      session,
      permissionsVersion: parseVersion(rawVersion as string | null),
      terminalRevoked,
      tenantBlocked,
    };
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
    const multi = readyMulti(this.redis).del(key);
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
    await readyMulti(this.redis).del(ids.map(sessionKey)).sRem(setKey, ids).exec();
  }

  async destroyForTerminal(tenantId: string, terminalId: string): Promise<void> {
    await this.redis.eval(SWAP_TERMINAL_SESSION, {
      keys: [terminalSessionKey(tenantId, terminalId)],
      arguments: [SESSION_PREFIX, EMPLOYEE_SESSIONS_PREFIX, '', '0'],
    });
  }

  async markTerminalRevoked(
    tenantId: string,
    terminalId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(terminalRevokedKey(tenantId, terminalId), '1', {
      expiration: { type: 'EX', value: ttlSeconds },
    });
  }

  // No lifetime: the flag lives as long as the block; unblock deletes it.
  async markTenantBlocked(tenantId: string): Promise<void> {
    await this.redis.set(tenantBlockedKey(tenantId), '1');
  }

  async clearTenantBlocked(tenantId: string): Promise<void> {
    await this.redis.del(tenantBlockedKey(tenantId));
  }
}

export class RedisPermissionsVersionCache extends PermissionsVersionCache {
  constructor(private readonly redis: RedisClient) {
    super();
  }

  async get(tenantId: string, employeeId: string): Promise<number | null> {
    return parseVersion(await this.redis.get(versionKey(tenantId, employeeId)));
  }

  async setIfGreater(tenantId: string, employeeId: string, version: number): Promise<void> {
    await this.redis.eval(SET_IF_GREATER, {
      keys: [versionKey(tenantId, employeeId)],
      arguments: [String(version), String(PERMISSIONS_VERSION_TTL_SECONDS)],
    });
  }
}
