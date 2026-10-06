import type { Permission } from '@pharmacy/shared-domain';
import { sql } from 'kysely';
import type { TenantDatabase } from '../database';
import {
  PermissionsVersionCache,
  SessionStore,
  type SessionLookup,
  type SessionPatch,
  type SessionRecord,
} from './session-store';

const NONE: SessionLookup = {
  session: null,
  permissionsVersion: null,
  terminalRevoked: false,
  tenantBlocked: false,
};

function toVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

function toScope(value: unknown): 'all' | string[] {
  if (value === 'all') return 'all';
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

const iso = (value: Date | string): string => new Date(value).toISOString();

// Offline-store implementation of SessionStore (auth design 2026-10-02, section 10; plan auth-part4):
// the sessions table of the store's PostgreSQL, read and written in withTenant(tenantId) under RLS.
// An offline store serves exactly one network (plan decision P1): a token or record of another
// tenant is reported as missing. Expired rows never authenticate and are deleted on every create
// (P2). The terminal's revocation is read from terminals.revoked_at in the same query (P3).
export class PgSessionStore extends SessionStore {
  constructor(
    private readonly db: TenantDatabase,
    private readonly tenantId: string,
  ) {
    super();
  }

  async create(record: SessionRecord): Promise<void> {
    if (record.tenantId !== this.tenantId) {
      throw new Error('An offline store issues sessions of its own network only');
    }
    const now = Date.now();
    const absolute = Date.parse(record.absoluteExpiresAt);
    const idle = Math.min(now + record.idleTtlSeconds * 1000, absolute);
    if (!(idle > now)) return;
    await this.db.withTenant(this.tenantId, async (trx) => {
      await trx
        .deleteFrom('sessions')
        .where('tenantId', '=', this.tenantId)
        .where((eb) =>
          eb.or([
            eb('idleExpiresAt', '<=', sql<Date>`now()`),
            eb('absoluteExpiresAt', '<=', sql<Date>`now()`),
          ]),
        )
        .execute();
      await trx
        .insertInto('sessions')
        .values({
          tenantId: this.tenantId,
          jti: record.sessionId,
          employeeId: record.employeeId,
          authMethod: record.auth,
          authenticatedAt: record.authenticatedAt,
          permissions: [...record.permissions],
          permissionsVersion: BigInt(record.permissionsVersion),
          storeScope: JSON.stringify(record.storeScope),
          currentStoreId: record.currentStoreId,
          terminalId: record.terminalId,
          terminalCredentialHash: record.terminalCredentialHash,
          locale: record.locale,
          idleTtlSeconds: record.idleTtlSeconds,
          idleExpiresAt: new Date(idle).toISOString(),
          absoluteExpiresAt: record.absoluteExpiresAt,
        })
        .execute();
    });
  }

  async lookup(
    sessionId: string,
    tenantId: string,
    employeeId: string,
  ): Promise<SessionLookup> {
    if (tenantId !== this.tenantId) return NONE;
    const row = await this.db.withTenant(this.tenantId, (trx) =>
      trx
        .selectFrom('sessions')
        .innerJoin('employees', (join) =>
          join
            .onRef('employees.tenantId', '=', 'sessions.tenantId')
            .onRef('employees.id', '=', 'sessions.employeeId'),
        )
        .innerJoin('tenants', 'tenants.id', 'sessions.tenantId')
        .leftJoin('terminals', (join) =>
          join
            .onRef('terminals.tenantId', '=', 'sessions.tenantId')
            .onRef('terminals.id', '=', 'sessions.terminalId'),
        )
        .selectAll('sessions')
        .select([
          'employees.permissionsVersion as currentVersion',
          sql<boolean>`terminals.revoked_at is not null`.as('terminalRevoked'),
          'tenants.status as tenantStatus',
        ])
        .where('sessions.tenantId', '=', this.tenantId)
        .where('sessions.jti', '=', sessionId)
        .where('sessions.employeeId', '=', employeeId)
        .where('sessions.idleExpiresAt', '>', sql<Date>`now()`)
        .where('sessions.absoluteExpiresAt', '>', sql<Date>`now()`)
        .executeTakeFirst(),
    );
    if (!row) return NONE;
    const recordVersion = toVersion(row.permissionsVersion);
    if (recordVersion === null) return NONE;
    const session: SessionRecord = {
      sessionId: row.jti,
      tenantId: row.tenantId,
      employeeId: row.employeeId,
      auth: row.authMethod === 'pin' ? 'pin' : 'password',
      authenticatedAt: iso(row.authenticatedAt),
      permissions: row.permissions as Permission[],
      permissionsVersion: recordVersion,
      storeScope: toScope(row.storeScope),
      currentStoreId: row.currentStoreId,
      terminalId: row.terminalId,
      terminalCredentialHash: row.terminalCredentialHash,
      locale: row.locale === 'tg' ? 'tg' : 'ru',
      idleTtlSeconds: row.idleTtlSeconds,
      absoluteExpiresAt: iso(row.absoluteExpiresAt),
    };
    return {
      session,
      permissionsVersion: toVersion(row.currentVersion),
      terminalRevoked: row.terminalRevoked === true,
      tenantBlocked: row.tenantStatus !== 'active',
    };
  }

  async update(sessionId: string, patch: SessionPatch): Promise<void> {
    const values: Record<string, unknown> = {};
    if (patch.permissions !== undefined) values.permissions = [...patch.permissions];
    if (patch.permissionsVersion !== undefined) {
      values.permissionsVersion = BigInt(patch.permissionsVersion);
    }
    if (patch.storeScope !== undefined) values.storeScope = JSON.stringify(patch.storeScope);
    if (patch.currentStoreId !== undefined) values.currentStoreId = patch.currentStoreId;
    if (patch.locale !== undefined) values.locale = patch.locale;
    if (Object.keys(values).length === 0) return;
    await this.db.withTenant(this.tenantId, (trx) =>
      trx
        .updateTable('sessions')
        .set(values)
        .where('tenantId', '=', this.tenantId)
        .where('jti', '=', sessionId)
        .execute(),
    );
  }

  async touch(sessionId: string, idleTtlSeconds: number): Promise<void> {
    await this.db.withTenant(this.tenantId, (trx) =>
      trx
        .updateTable('sessions')
        .set({
          idleExpiresAt: sql<Date>`least(now() + make_interval(secs => ${idleTtlSeconds}), absolute_expires_at)`,
        })
        .where('tenantId', '=', this.tenantId)
        .where('jti', '=', sessionId)
        .execute(),
    );
  }

  async destroy(sessionId: string): Promise<void> {
    await this.db.withTenant(this.tenantId, (trx) =>
      trx
        .deleteFrom('sessions')
        .where('tenantId', '=', this.tenantId)
        .where('jti', '=', sessionId)
        .execute(),
    );
  }

  async destroyAllFor(
    tenantId: string,
    employeeId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    if (tenantId !== this.tenantId) return;
    await this.db.withTenant(this.tenantId, (trx) => {
      let query = trx
        .deleteFrom('sessions')
        .where('tenantId', '=', this.tenantId)
        .where('employeeId', '=', employeeId);
      if (exceptSessionId !== undefined) query = query.where('jti', '<>', exceptSessionId);
      return query.execute();
    });
  }

  async destroyForTerminal(tenantId: string, terminalId: string): Promise<void> {
    if (tenantId !== this.tenantId) return;
    await this.db.withTenant(this.tenantId, (trx) =>
      trx
        .deleteFrom('sessions')
        .where('tenantId', '=', this.tenantId)
        .where('terminalId', '=', terminalId)
        .execute(),
    );
  }

  // terminals.revoked_at is the source of truth and lookup reads it directly (plan decision P3).
  markTerminalRevoked(): Promise<void> {
    return Promise.resolve();
  }

  // tenants.status (synchronized from the cloud) is read by lookup directly.
  markTenantBlocked(): Promise<void> {
    return Promise.resolve();
  }

  clearTenantBlocked(): Promise<void> {
    return Promise.resolve();
  }
}

// The current permissions_version straight from employees (plan decision P4); nothing to cache.
export class PgPermissionsVersionCache extends PermissionsVersionCache {
  constructor(
    private readonly db: TenantDatabase,
    private readonly tenantId: string,
  ) {
    super();
  }

  async get(tenantId: string, employeeId: string): Promise<number | null> {
    if (tenantId !== this.tenantId) return null;
    const row = await this.db.withTenant(this.tenantId, (trx) =>
      trx
        .selectFrom('employees')
        .select('permissionsVersion')
        .where('tenantId', '=', this.tenantId)
        .where('id', '=', employeeId)
        .executeTakeFirst(),
    );
    return row ? toVersion(row.permissionsVersion) : null;
  }

  // lookup reads the version from employees on every request: there is no cache to write.
  setIfGreater(): Promise<void> {
    return Promise.resolve();
  }
}
