import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RedisModule } from './redis.module';
import { REDIS_CLIENT } from './redis.tokens';

// Stands in for the global ConfigModule of the application.
function configModule(values: Record<string, string>) {
  @Global()
  @Module({
    providers: [{ provide: ConfigService, useValue: { getOrThrow: (key: string) => values[key] } }],
    exports: [ConfigService],
  })
  class TestConfigModule {}
  return TestConfigModule;
}

describe('RedisModule', () => {
  it('creates no client and connects to nothing in offline mode', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [configModule({ STORE_MODE: 'offline' }), RedisModule],
    }).compile();

    expect(moduleRef.get(REDIS_CLIENT)).toBeNull();
    await expect(moduleRef.init()).resolves.toBeDefined();
    await moduleRef.close();
  });

  it('creates a client in cloud mode that stays closed until init', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        configModule({ STORE_MODE: 'cloud', REDIS_URL: 'redis://127.0.0.1:6390' }),
        RedisModule,
      ],
    }).compile();

    const client = moduleRef.get(REDIS_CLIENT);
    expect(client).not.toBeNull();
    expect(client.isOpen).toBe(false);
    await moduleRef.close();
  });
});
