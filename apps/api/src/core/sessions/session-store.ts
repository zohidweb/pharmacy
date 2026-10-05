import type { Permission } from '@pharmacy/shared-domain';

// Server-side session record (design 2026-10-02, section 5). Never logged: it carries ids and
// permissions. Never holds secrets.
export interface SessionRecord {
  sessionId: string;
  tenantId: string;
  employeeId: string;
  auth: 'password' | 'pin';
  authenticatedAt: string;
  permissions: Permission[];
  permissionsVersion: number;
  storeScope: 'all' | string[];
  currentStoreId: string | null;
  terminalId: string | null;
  terminalCredentialHash: string | null;
  locale: 'ru' | 'tg';
  idleTtlSeconds: number;
  absoluteExpiresAt: string;
}

export type SessionPatch = Partial<
  Pick<
    SessionRecord,
    'permissions' | 'permissionsVersion' | 'storeScope' | 'currentStoreId' | 'locale'
  >
>;

export interface SessionLookup {
  session: SessionRecord | null;
  permissionsVersion: number | null;
  /** True when the session belongs to a terminal that has been revoked (PIN session only). */
  terminalRevoked: boolean;
}

// Port: Redis in the cloud, PostgreSQL on an offline store. DI token.
export abstract class SessionStore {
  abstract create(record: SessionRecord): Promise<void>;

  // The record and the current permissions version in one round trip. tenantId/employeeId come from
  // the verified token; a record that belongs to another pair is reported as missing.
  abstract lookup(sessionId: string, tenantId: string, employeeId: string): Promise<SessionLookup>;

  abstract update(sessionId: string, patch: SessionPatch): Promise<void>;

  // Extends the idle lifetime, never beyond absoluteExpiresAt.
  abstract touch(sessionId: string, idleTtlSeconds: number): Promise<void>;

  abstract destroy(sessionId: string): Promise<void>;

  abstract destroyAllFor(
    tenantId: string,
    employeeId: string,
    exceptSessionId?: string,
  ): Promise<void>;

  // The PIN session of a terminal (one at a time: a new PIN sign-in replaces it), auth design
  // 2026-10-02, section 8.
  abstract destroyForTerminal(tenantId: string, terminalId: string): Promise<void>;

  // A revocation flag that lookup reports for every session of the terminal; it lives at least as
  // long as any session created before the revocation. terminals.revoked_at stays the source of
  // truth.
  abstract markTerminalRevoked(
    tenantId: string,
    terminalId: string,
    ttlSeconds: number,
  ): Promise<void>;
}

// Port: the current permissions_version of an employee. DI token.
export abstract class PermissionsVersionCache {
  abstract get(tenantId: string, employeeId: string): Promise<number | null>;

  // The only writer: stores the version when none is cached or the cached one is lower, and then
  // refreshes the lifetime. Monotonic, so writers racing in any order (the post-commit write of a
  // bump, a cache-miss fill from a database read, the login seed) never move the cache backwards.
  abstract setIfGreater(tenantId: string, employeeId: string, version: number): Promise<void>;
}
