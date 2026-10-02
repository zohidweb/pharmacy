import {
  Global,
  Inject,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRedisClient, REDIS_CLIENT, type RedisClient } from './redis.tokens';

// Redis is used in the cloud only (sessions, permissions version). On an offline store
// (STORE_MODE=offline) no client is created and nothing connects: REDIS_CLIENT is null.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisClient | null => {
        if (config.getOrThrow<string>('STORE_MODE') !== 'cloud') return null;
        const client = createRedisClient(config.getOrThrow<string>('REDIS_URL'));
        // Without a listener an 'error' event would crash the process.
        client.on('error', (error: Error) => {
          new Logger('Redis').error(`Redis client error: ${error.message}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient | null) {}

  async onModuleInit(): Promise<void> {
    await this.client?.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.close();
  }
}
