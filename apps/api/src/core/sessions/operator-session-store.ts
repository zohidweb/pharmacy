import { type RedisClient, readyMulti } from '../redis/redis.tokens';

// Server-side session of a platform operator (auth design 2026-10-02, section 9). Ids only, never
// secrets; never logged.
export interface OperatorSessionRecord {
  sessionId: string;
  operatorId: string;
  authenticatedAt: string;
  idleTtlSeconds: number;
  absoluteExpiresAt: string;
  /**
   * Browser and OS of the sign-in («Chrome · Windows»), for the operator's list of sessions; never
   * the raw user agent. Absent in a record stored before the list existed.
   */
  device?: string;
  /** The last request, as precise as the idle extension (once a minute); absent as `device`. */
  lastSeenAt?: string;
}

// Port of the operator contour. The cloud only: an offline store has no operator routes.
export abstract class OperatorSessionStore {
  abstract create(record: OperatorSessionRecord): Promise<void>;

  // A record that belongs to another operator is reported as missing.
  abstract lookup(
    sessionId: string,
    operatorId: string,
  ): Promise<OperatorSessionRecord | null>;

  // The live sessions of the operator, in no particular order.
  abstract listFor(operatorId: string): Promise<OperatorSessionRecord[]>;

  // Extends the idle lifetime, never beyond absoluteExpiresAt, and records the time as lastSeenAt.
  abstract touch(sessionId: string, idleTtlSeconds: number): Promise<void>;

  abstract destroy(sessionId: string): Promise<void>;

  abstract destroyAllFor(operatorId: string, exceptSessionId?: string): Promise<void>;
}

const sessionKey = (sessionId: string): string => `op-sess:${sessionId}`;
const operatorSessionsKey = (operatorId: string): string =>
  `op-emp-sess:${operatorId}`;

// Rewrites the record with a new lifetime only while it still holds the value that was read: a
// session destroyed meanwhile (sign-out, a disabled operator) is never written back to life.
const COMPARE_AND_SET_PX = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`;

// Idle lifetime in ms, capped by the absolute expiry; null when the session has already expired.
function lifetimeMs(idleTtlSeconds: number, absoluteExpiresAt: string): number | null {
  const untilAbsolute = Date.parse(absoluteExpiresAt) - Date.now();
  const ms = Math.min(idleTtlSeconds * 1000, untilAbsolute);
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms) : null;
}

function parseRecord(raw: string | null): OperatorSessionRecord | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object'
      ? (value as OperatorSessionRecord)
      : null;
  } catch {
    return null;
  }
}

// Keys: op-sess:<id> (JSON, PX = idle lifetime capped by the absolute expiry) and
// op-emp-sess:<operatorId> (set of the operator's session ids), as RedisSessionStore does.
export class RedisOperatorSessionStore extends OperatorSessionStore {
  constructor(private readonly redis: RedisClient) {
    super();
  }

  async create(record: OperatorSessionRecord): Promise<void> {
    const ttl = lifetimeMs(record.idleTtlSeconds, record.absoluteExpiresAt);
    // Never silently: the caller would hand out a cookie of a session that does not exist.
    if (ttl === null) throw new Error('The session to store has already expired');
    const setKey = operatorSessionsKey(record.operatorId);
    const absoluteMs = Math.ceil(Date.parse(record.absoluteExpiresAt) - Date.now());
    await readyMulti(this.redis)
      .set(sessionKey(record.sessionId), JSON.stringify(record), {
        expiration: { type: 'PX', value: ttl },
      })
      .sAdd(setKey, record.sessionId)
      .pExpire(setKey, absoluteMs, 'NX')
      .pExpire(setKey, absoluteMs, 'GT')
      .exec();
  }

  async lookup(
    sessionId: string,
    operatorId: string,
  ): Promise<OperatorSessionRecord | null> {
    const record = parseRecord(await this.redis.get(sessionKey(sessionId)));
    if (
      record === null ||
      record.sessionId !== sessionId ||
      record.operatorId !== operatorId
    ) {
      return null;
    }
    return record;
  }

  async listFor(operatorId: string): Promise<OperatorSessionRecord[]> {
    const setKey = operatorSessionsKey(operatorId);
    const ids = await this.redis.sMembers(setKey);
    if (ids.length === 0) return [];
    const raws = await this.redis.mGet(ids.map(sessionKey));
    const records: OperatorSessionRecord[] = [];
    const expired: string[] = [];
    ids.forEach((id, index) => {
      const raw = raws[index] ?? null;
      const record = parseRecord(raw);
      if (record !== null && record.sessionId === id && record.operatorId === operatorId) {
        records.push(record);
      } else if (raw === null) {
        // Ended by expiry, without a destroy: the id is dropped from the set.
        expired.push(id);
      }
    });
    if (expired.length > 0) await this.redis.sRem(setKey, expired);
    return records;
  }

  async touch(sessionId: string, idleTtlSeconds: number): Promise<void> {
    const key = sessionKey(sessionId);
    const raw = await this.redis.get(key);
    const record = parseRecord(raw);
    if (raw === null || record === null) return;
    const ttl = lifetimeMs(idleTtlSeconds, record.absoluteExpiresAt);
    if (ttl === null) {
      await this.destroy(sessionId);
      return;
    }
    // A record changed meanwhile was touched by a concurrent request: nothing is lost.
    await this.redis.eval(COMPARE_AND_SET_PX, {
      keys: [key],
      arguments: [
        raw,
        JSON.stringify({ ...record, lastSeenAt: new Date().toISOString() }),
        String(ttl),
      ],
    });
  }

  async destroy(sessionId: string): Promise<void> {
    const key = sessionKey(sessionId);
    const record = parseRecord(await this.redis.get(key));
    const multi = readyMulti(this.redis).del(key);
    if (record !== null) {
      multi.sRem(operatorSessionsKey(record.operatorId), sessionId);
    }
    await multi.exec();
  }

  async destroyAllFor(operatorId: string, exceptSessionId?: string): Promise<void> {
    const setKey = operatorSessionsKey(operatorId);
    const ids = (await this.redis.sMembers(setKey)).filter(
      (id) => id !== exceptSessionId,
    );
    if (ids.length === 0) return;
    await readyMulti(this.redis).del(ids.map(sessionKey)).sRem(setKey, ids).exec();
  }
}
