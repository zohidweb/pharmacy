import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  TENANT_DATABASE_SETTINGS,
  type DatabaseSettings,
} from './database-settings';
import { createPool } from './pool';

export type LoginKind = 'login' | 'phone' | 'email';

export interface ResolvedLogin {
  tenantId: string;
  employeeId: string;
  tenantStatus: string;
}

export interface ResolvedTerminal {
  tenantId: string;
  storeId: string;
  terminalId: string;
  revoked: boolean;
  tenantStatus: string;
}

export interface ResolvedLicenseKey {
  keyHash: Buffer;
  tenantId: string;
  storeId: string;
  status: string;
  validUntil: Date;
  revokedAt: Date | null;
  notifyBeforeDays: number;
  storeStatus: string;
  storeClosedAt: Date | null;
  storeMode: string;
  tenantStatus: string;
}

const LOGIN_KINDS: readonly string[] = ['login', 'phone', 'email'];

// The only statement this class ever sends; the values are bound parameters.
const RESOLVE_LOGIN_SQL =
  'select tenant_id, employee_id, tenant_status from pharmacy.resolve_login($1, $2)';

const RESOLVE_TERMINAL_SQL =
  'select tenant_id, store_id, terminal_id, revoked, tenant_status from pharmacy.resolve_terminal($1)';

const RESOLVE_LICENSE_KEY_SQL =
  'select key_hash, tenant_id, store_id, status, valid_until, revoked_at, notify_before_days, ' +
  'store_status, store_closed_at, store_mode, tenant_status from pharmacy.resolve_license_key($1)';

// A small pool: resolvers run once per sign-in and once per sync request of an offline store.
const RESOLVER_POOL_MAX = 2;

interface ResolveLoginRow {
  tenant_id: string;
  employee_id: string;
  tenant_status: string;
}

interface ResolveTerminalRow {
  tenant_id: string;
  store_id: string;
  terminal_id: string;
  revoked: boolean;
  tenant_status: string;
}

interface ResolveLicenseKeyRow {
  key_hash: Buffer;
  tenant_id: string;
  store_id: string;
  status: string;
  valid_until: Date;
  revoked_at: Date | null;
  notify_before_days: number;
  store_status: string;
  store_closed_at: Date | null;
  store_mode: string;
  tenant_status: string;
}

// The open key id of a license key: phk_<16 hex>_<secret> (spec 2026-10-16-offline-sync, E10).
const LICENSE_KEY_ID = /^[0-9a-f]{16}$/;

// SHA-256 of the device secret (terminals.credential_hash).
const CREDENTIAL_HASH_BYTES = 32;

// Pre-context resolvers (ADR-0013 p. 3, amendment 2026-10-02): before a tenant context exists,
// a sign-in identifier is mapped to its tenant by the SECURITY DEFINER function
// pharmacy.resolve_login (and a device-cookie hash by pharmacy.resolve_terminal), which return
// ids and the tenant status only. Role pharmacy_app (the
// tenant settings, no tenant context set), its own pool and application_name 'api-resolver';
// only fixed calls of pharmacy.resolve_* functions — no table is ever read from here.
@Injectable()
export class ContextResolvers implements OnModuleDestroy {
  private pool?: Pool;
  private closed?: Promise<void>;

  constructor(
    @Inject(TENANT_DATABASE_SETTINGS)
    private readonly settings: DatabaseSettings,
  ) {}

  /**
   * The tenant and employee of a normalized identifier (lower-cased login or e-mail, E.164
   * phone), or null when nothing matches. The value is compared as given.
   */
  async resolveLogin(
    kind: LoginKind,
    value: string,
  ): Promise<ResolvedLogin | null> {
    // Runtime check: callers may pass anything despite the type. The value is never echoed.
    if (!LOGIN_KINDS.includes(kind)) throw new Error('Invalid login kind');
    const { rows } = await this.getPool().query<ResolveLoginRow>(
      RESOLVE_LOGIN_SQL,
      [kind, value],
    );
    // Identifiers are globally unique; anything but exactly one row fails closed.
    if (rows.length !== 1) return null;
    const [row] = rows;
    return {
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      tenantStatus: row.tenant_status,
    };
  }

  /**
   * The terminal of a device-cookie SHA-256 (auth design, section 8), or null when nothing
   * matches. A revoked terminal is returned with revoked = true; the caller decides.
   */
  async resolveTerminal(
    credentialHash: Buffer,
  ): Promise<ResolvedTerminal | null> {
    if (credentialHash.length !== CREDENTIAL_HASH_BYTES) return null;
    const { rows } = await this.getPool().query<ResolveTerminalRow>(
      RESOLVE_TERMINAL_SQL,
      [credentialHash],
    );
    // credential_hash is unique; anything but exactly one row fails closed.
    if (rows.length !== 1) return null;
    const [row] = rows;
    return {
      tenantId: row.tenant_id,
      storeId: row.store_id,
      terminalId: row.terminal_id,
      revoked: row.revoked,
      tenantStatus: row.tenant_status,
    };
  }

  /**
   * The license key of an offline store by its open key id (spec 2026-10-16-offline-sync, E10), or null when
   * nothing matches. The caller compares the secret with `keyHash` and decides on the status.
   */
  async resolveLicenseKey(keyId: string): Promise<ResolvedLicenseKey | null> {
    if (!LICENSE_KEY_ID.test(keyId)) return null;
    const { rows } = await this.getPool().query<ResolveLicenseKeyRow>(
      RESOLVE_LICENSE_KEY_SQL,
      [keyId],
    );
    // key_id is unique; anything but exactly one row fails closed.
    if (rows.length !== 1) return null;
    const [row] = rows;
    return {
      keyHash: row.key_hash,
      tenantId: row.tenant_id,
      storeId: row.store_id,
      status: row.status,
      validUntil: row.valid_until,
      revokedAt: row.revoked_at,
      notifyBeforeDays: row.notify_before_days,
      storeStatus: row.store_status,
      storeClosedAt: row.store_closed_at,
      storeMode: row.store_mode,
      tenantStatus: row.tenant_status,
    };
  }

  onModuleDestroy(): Promise<void> {
    this.closed ??= this.pool ? this.pool.end() : Promise.resolve();
    return this.closed;
  }

  // Created on the first call, so the API starts without a reachable database.
  private getPool(): Pool {
    if (this.closed) throw new Error('ContextResolvers is closed');
    this.pool ??= createPool({
      connectionString: this.settings.url,
      applicationName: 'api-resolver',
      max: RESOLVER_POOL_MAX,
      connectionTimeoutMillis: this.settings.connectionTimeoutMs,
      // No transaction here to set it locally: the timeout is a connection setting.
      statementTimeoutMillis: this.settings.statementTimeoutMs,
    });
    return this.pool;
  }
}
