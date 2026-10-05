import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantDatabase } from '../database';
import { RedisModule } from '../redis/redis.module';
import { REDIS_CLIENT, type RedisClient } from '../redis/redis.tokens';
import {
  OperatorSessionStore,
  type OperatorSessionRecord,
  RedisOperatorSessionStore,
} from './operator-session-store';
import { PgPermissionsVersionCache, PgSessionStore } from './pg-session-store';
import { RedisPermissionsVersionCache, RedisSessionStore } from './redis-session-store';
import { PermissionsVersionCache, SessionStore } from './session-store';

// An offline store has no operator contour (its modules are not registered); this stand-in only
// keeps the provider graph whole and fails loudly if anything ever reaches it.
class NoOperatorSessionStore extends OperatorSessionStore {
  private fail(): never {
    throw new Error('Operator sessions do not exist on an offline store');
  }
  create(_record: OperatorSessionRecord): Promise<void> {
    return this.fail();
  }
  lookup(): Promise<OperatorSessionRecord | null> {
    return this.fail();
  }
  touch(): Promise<void> {
    return this.fail();
  }
  destroy(): Promise<void> {
    return this.fail();
  }
  destroyAllFor(): Promise<void> {
    return this.fail();
  }
}

// The network of an offline store; env validation guarantees it with STORE_MODE=offline.
function offlineTenant(config: ConfigService): string {
  return config.getOrThrow<string>('OFFLINE_TENANT_ID');
}

// Session stores by STORE_MODE (auth design 2026-10-02, sections 4 and 10): Redis in the cloud
// (REDIS_CLIENT is set), the store's PostgreSQL on an offline store (REDIS_CLIENT is null).
// Exports the abstract ports only.
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: SessionStore,
      inject: [REDIS_CLIENT, TenantDatabase, ConfigService],
      useFactory: (
        client: RedisClient | null,
        db: TenantDatabase,
        config: ConfigService,
      ): SessionStore =>
        client === null
          ? new PgSessionStore(db, offlineTenant(config))
          : new RedisSessionStore(client),
    },
    {
      provide: PermissionsVersionCache,
      inject: [REDIS_CLIENT, TenantDatabase, ConfigService],
      useFactory: (
        client: RedisClient | null,
        db: TenantDatabase,
        config: ConfigService,
      ): PermissionsVersionCache =>
        client === null
          ? new PgPermissionsVersionCache(db, offlineTenant(config))
          : new RedisPermissionsVersionCache(client),
    },
    {
      provide: OperatorSessionStore,
      inject: [REDIS_CLIENT],
      useFactory: (client: RedisClient | null): OperatorSessionStore =>
        client === null
          ? new NoOperatorSessionStore()
          : new RedisOperatorSessionStore(client),
    },
  ],
  exports: [SessionStore, PermissionsVersionCache, OperatorSessionStore],
})
export class SessionsModule {}
