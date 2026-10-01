import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  CamelCasePlugin,
  Kysely,
  PostgresDialect,
  sql,
  type Transaction,
} from 'kysely';
import {
  PLATFORM_DATABASE_SETTINGS,
  type DatabaseSettings,
} from '../database-settings';
import type { DB } from '../db.generated';
import { isUuid } from '../ids';
import { createPool } from '../pool';

/** Who acts on the platform path (ADR-0013 p. 7): an operator session or a named system job. */
export type PlatformActor =
  { kind: 'operator'; operatorId: string } | { kind: 'system'; job: string };

const JOB_NAME = /^[a-z0-9.-]{1,64}$/;

// Validates the actor at runtime (callers may pass anything despite the type) and returns the
// value of app.actor. Fail-closed: no valid actor, no transaction.
function actorSetting(actor: unknown): string {
  if (typeof actor === 'object' && actor !== null) {
    const { kind, operatorId, job } = actor as Record<string, unknown>;
    if (kind === 'operator' && isUuid(operatorId))
      return `operator:${operatorId}`;
    if (kind === 'system' && typeof job === 'string' && JOB_NAME.test(job))
      return `system:${job}`;
  }
  throw new Error('Invalid platform actor');
}

// The cross-tenant path (ADR-0013 p. 7): role pharmacy_platform without BYPASSRLS, its own pool
// and application_name. The actor and timeouts are set transaction-locally as the first statement.
// Only modules of app/platform/** (and sync on the offline store) may import PlatformDatabaseModule.
@Injectable()
export class PlatformDatabase implements OnModuleDestroy {
  private readonly db: Kysely<DB>;
  private readonly statementTimeout: string;
  private readonly lockTimeout: string;
  private destroyed?: Promise<void>;

  constructor(@Inject(PLATFORM_DATABASE_SETTINGS) settings: DatabaseSettings) {
    this.statementTimeout = String(settings.statementTimeoutMs);
    this.lockTimeout = String(settings.lockTimeoutMs);
    this.db = new Kysely<DB>({
      // A pool factory: created on the first transaction, ended in destroy().
      dialect: new PostgresDialect({
        pool: async () =>
          createPool({
            connectionString: settings.url,
            applicationName: 'api-platform',
            max: settings.poolMax,
            connectionTimeoutMillis: settings.connectionTimeoutMs,
          }),
      }),
      plugins: [new CamelCasePlugin()],
    });
  }

  async platformTransaction<T>(
    actor: PlatformActor,
    work: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    const appActor = actorSetting(actor);
    return this.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.actor', ${appActor}, true),
                       set_config('statement_timeout', ${this.statementTimeout}, true),
                       set_config('lock_timeout', ${this.lockTimeout}, true)`.execute(
        trx,
      );
      return work(trx);
    });
  }

  onModuleDestroy(): Promise<void> {
    this.destroyed ??= this.db.destroy();
    return this.destroyed;
  }
}
