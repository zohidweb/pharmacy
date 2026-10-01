import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  CamelCasePlugin,
  Kysely,
  PostgresDialect,
  sql,
  type Transaction,
} from 'kysely';
import { requireTenantId } from '../../common/context/request-context';
import {
  TENANT_DATABASE_SETTINGS,
  type DatabaseSettings,
} from './database-settings';
import type { DB } from './db.generated';
import { isUuid } from './ids';
import { createPool } from './pool';

export type TenantTransaction = Transaction<DB>;

// The only path of apps/api to tenant tables (ADR-0006 rule 1, ADR-0013 p. 7): role pharmacy_app,
// one Kysely transaction per unit of work, the tenant context and timeouts set transaction-locally
// (set_config(..., true)) as its first statement, so they end with the transaction and never
// survive on a pooled connection. Services receive the transaction, never the root Kysely.
@Injectable()
export class TenantDatabase implements OnModuleDestroy {
  private readonly db: Kysely<DB>;
  private readonly statementTimeout: string;
  private readonly lockTimeout: string;
  private destroyed?: Promise<void>;

  constructor(@Inject(TENANT_DATABASE_SETTINGS) settings: DatabaseSettings) {
    this.statementTimeout = String(settings.statementTimeoutMs);
    this.lockTimeout = String(settings.lockTimeoutMs);
    this.db = new Kysely<DB>({
      // A pool factory: Kysely creates the pool on the first transaction (the API starts without
      // a reachable database) and ends it in destroy().
      dialect: new PostgresDialect({
        pool: async () =>
          createPool({
            connectionString: settings.url,
            applicationName: 'api-tenant',
            max: settings.poolMax,
            connectionTimeoutMillis: settings.connectionTimeoutMs,
          }),
      }),
      plugins: [new CamelCasePlugin()],
    });
  }

  async withTenant<T>(
    tenantId: string,
    work: (trx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    // Fail before any database call; the value is never echoed into the message.
    if (!isUuid(tenantId)) throw new Error('Invalid tenant id');
    return this.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true),
                       set_config('statement_timeout', ${this.statementTimeout}, true),
                       set_config('lock_timeout', ${this.lockTimeout}, true)`.execute(
        trx,
      );
      return work(trx);
    });
  }

  /** withTenant for the tenant of the current request context; fails without one. */
  async tenantTransaction<T>(
    work: (trx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return this.withTenant(requireTenantId(), work);
  }

  onModuleDestroy(): Promise<void> {
    this.destroyed ??= this.db.destroy();
    return this.destroyed;
  }
}
