import type { RedisClient } from '../redis/redis.tokens';

// Server-side session of a platform operator (auth design 2026-10-02, section 9). Ids only, never
// secrets; never logged.
export interface OperatorSessionRecord {
  sessionId: string;
  operatorId: string;
  authenticatedAt: string;
  idleTtlSeconds: number;
  absoluteExpiresAt: string;
}

// Port of the operator contour. The cloud only: an offline store has no operator routes.
export abstract class OperatorSessionStore {
  abstract create(record: OperatorSessionRecord): Promise<void>;

  // A record that belongs to another operator is reported as missing.
  abstract lookup(
    sessionId: string,
    operatorId: string,
  ): Promise<OperatorSessionRecord | null>;

  // Extends the idle lifetime, never beyond absoluteExpiresAt.
  abstract touch(sessionId: string, idleTtlSeconds: number): Promise<void>;

  abstract destroy(sessionId: string): Promise<void>;

  abstract destroyAllFor(operatorId: string, exceptSessionId?: string): Promise<void>;
}

const sessionKey = (sessionId: string): string => `op-sess:${sessionId}`;
const operatorSessionsKey = (operatorId: string): string =>
  `op-emp-sess:${operatorId}`;

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
    if (ttl === null) return;
    const setKey = operatorSessionsKey(record.operatorId);
    const absoluteMs = Math.ceil(Date.parse(record.absoluteExpiresAt) - Date.now());
    await this.redis
      .multi()
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
    await this.redis.multi().del(ids.map(sessionKey)).sRem(setKey, ids).exec();
  }
}
