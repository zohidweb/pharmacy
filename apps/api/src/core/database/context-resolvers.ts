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

const LOGIN_KINDS: readonly string[] = ['login', 'phone', 'email'];

// The only statement this class ever sends; the values are bound parameters.
const RESOLVE_LOGIN_SQL =
  'select tenant_id, employee_id, tenant_status from pharmacy.resolve_login($1, $2)';

// A small pool: resolvers run once per sign-in, never per request.
const RESOLVER_POOL_MAX = 2;

interface ResolveLoginRow {
  tenant_id: string;
  employee_id: string;
  tenant_status: string;
}

// Pre-context resolvers (ADR-0013 p. 3, amendment 2026-10-02): before a tenant context exists,
// a sign-in identifier is mapped to its tenant by the SECURITY DEFINER function
// pharmacy.resolve_login, which returns ids and the tenant status only. Role pharmacy_app (the
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
