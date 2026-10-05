import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { REDIS_CLIENT, type RedisClient } from '../redis/redis.tokens';
import { RedisPermissionsVersionCache, RedisSessionStore } from './redis-session-store';
import { PermissionsVersionCache, SessionStore } from './session-store';

function cloudClient(client: RedisClient | null): RedisClient {
  // The PostgreSQL implementations for STORE_MODE=offline arrive with part 4 of the auth design.
  if (client === null) {
    throw new Error('Sessions support STORE_MODE=cloud only until part 4 of the auth design');
  }
  return client;
}

// Cloud: Redis-backed session store and permissions version cache; exports the abstract ports.
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: SessionStore,
      inject: [REDIS_CLIENT],
      useFactory: (client: RedisClient | null) => new RedisSessionStore(cloudClient(client)),
    },
    {
      provide: PermissionsVersionCache,
      inject: [REDIS_CLIENT],
      useFactory: (client: RedisClient | null) =>
        new RedisPermissionsVersionCache(cloudClient(client)),
    },
  ],
  exports: [SessionStore, PermissionsVersionCache],
})
export class SessionsModule {}
