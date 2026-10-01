import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  PLATFORM_DATABASE_SETTINGS,
  TENANT_DATABASE_SETTINGS,
} from './database-settings';
import { DatabaseModule, TenantDatabase } from './index';
import { PlatformDatabase, PlatformDatabaseModule } from './platform';

// Synthetic, unreachable URLs: the modules must wire without touching a database (lazy pools).
const env = {
  DATABASE_URL: 'postgresql://tenant-role@127.0.0.1:1/unit',
  PLATFORM_DATABASE_URL: 'postgresql://platform-role@127.0.0.1:1/unit',
  DB_POOL_MAX: 7,
  PLATFORM_DB_POOL_MAX: 2,
  DB_STATEMENT_TIMEOUT_MS: 1500,
  DB_LOCK_TIMEOUT_MS: 700,
  DB_CONNECTION_TIMEOUT_MS: 900,
};

async function compile() {
  return Test.createTestingModule({
    imports: [
      // validate() result is what ConfigService serves first, so process.env cannot interfere.
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: () => env,
      }),
      DatabaseModule,
      PlatformDatabaseModule,
    ],
  }).compile();
}

describe('database modules', () => {
  it('wires the tenant path from DATABASE_URL and DB_POOL_MAX', async () => {
    const moduleRef = await compile();
    expect(moduleRef.get(TenantDatabase)).toBeInstanceOf(TenantDatabase);
    expect(moduleRef.get(TENANT_DATABASE_SETTINGS, { strict: false })).toEqual({
      url: env.DATABASE_URL,
      poolMax: 7,
      statementTimeoutMs: 1500,
      lockTimeoutMs: 700,
      connectionTimeoutMs: 900,
    });
    await moduleRef.close();
  });

  it('wires the platform path from PLATFORM_DATABASE_URL and PLATFORM_DB_POOL_MAX', async () => {
    const moduleRef = await compile();
    expect(moduleRef.get(PlatformDatabase)).toBeInstanceOf(PlatformDatabase);
    expect(
      moduleRef.get(PLATFORM_DATABASE_SETTINGS, { strict: false }),
    ).toEqual({
      url: env.PLATFORM_DATABASE_URL,
      poolMax: 2,
      statementTimeoutMs: 1500,
      lockTimeoutMs: 700,
      connectionTimeoutMs: 900,
    });
    await moduleRef.close();
  });

  it('closes cleanly when no transaction was ever opened', async () => {
    const moduleRef = await compile();
    await expect(moduleRef.close()).resolves.toBeUndefined();
  });
});
