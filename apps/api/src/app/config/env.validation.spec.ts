import { validateEnv } from './env.validation';

const urls = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  PLATFORM_DATABASE_URL: 'postgres://u:p@h:5432/d',
};

describe('validateEnv', () => {
  it('applies defaults when variables are absent', () => {
    expect(validateEnv(urls)).toMatchObject({
      NODE_ENV: 'development',
      APP_ENV: 'dev',
      PORT: 3000,
      DB_POOL_MAX: 10,
      PLATFORM_DB_POOL_MAX: 3,
      DB_STATEMENT_TIMEOUT_MS: 5000,
      DB_LOCK_TIMEOUT_MS: 2000,
      DB_CONNECTION_TIMEOUT_MS: 5000,
    });
  });

  it('converts PORT from a string', () => {
    expect(validateEnv({ ...urls, PORT: '3001' }).PORT).toBe(3001);
  });

  it('rejects an unknown APP_ENV', () => {
    expect(() => validateEnv({ ...urls, APP_ENV: 'staging' })).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ ...urls, PORT: 'abc' })).toThrow(/Invalid environment configuration/);
  });

  it('requires DATABASE_URL and PLATFORM_DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...urls, DATABASE_URL: 'mysql://x' })).toThrow(/Invalid environment configuration/);
  });

  it('converts DB_STATEMENT_TIMEOUT_MS from a string', () => {
    expect(validateEnv({ ...urls, DB_STATEMENT_TIMEOUT_MS: '1500' }).DB_STATEMENT_TIMEOUT_MS).toBe(1500);
  });
});
