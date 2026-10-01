import type { ConfigService } from '@nestjs/config';

// Connection settings of one database path (ADR-0013 p. 7: tenant and platform pools differ in
// role, URL and size; the timeouts are shared).
export interface DatabaseSettings {
  url: string;
  poolMax: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  connectionTimeoutMs: number;
}

export const TENANT_DATABASE_SETTINGS = Symbol('TENANT_DATABASE_SETTINGS');
export const PLATFORM_DATABASE_SETTINGS = Symbol('PLATFORM_DATABASE_SETTINGS');

// Values are already validated and converted by validateEnv (app/config/env.validation.ts).
export function databaseSettings(
  config: ConfigService,
  keys: { url: string; poolMax: string },
): DatabaseSettings {
  return {
    url: config.getOrThrow<string>(keys.url),
    poolMax: config.getOrThrow<number>(keys.poolMax),
    statementTimeoutMs: config.getOrThrow<number>('DB_STATEMENT_TIMEOUT_MS'),
    lockTimeoutMs: config.getOrThrow<number>('DB_LOCK_TIMEOUT_MS'),
    connectionTimeoutMs: config.getOrThrow<number>('DB_CONNECTION_TIMEOUT_MS'),
  };
}
