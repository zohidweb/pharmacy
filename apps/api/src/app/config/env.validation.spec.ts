import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.validation';

const secret = (): string => randomBytes(32).toString('base64url');

const without = (
  env: Record<string, string>,
  key: string,
): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));

// Synthetic values generated per run: nothing here is a real secret.
const base = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  PLATFORM_DATABASE_URL: 'postgres://u:p@h:5432/d',
  REDIS_URL: 'redis://:p@h:6379',
  SESSION_JWT_KEYS: `k1:${secret()}`,
  SESSION_JWT_ACTIVE_KID: 'k1',
  PASSWORD_PEPPERS: `1:${secret()}`,
  PASSWORD_PEPPER_ACTIVE: '1',
  WEB_ORIGIN: 'http://localhost:4200',
  ADMIN_ORIGIN: 'http://localhost:4300',
};

describe('validateEnv', () => {
  it('applies defaults when variables are absent', () => {
    expect(validateEnv(base)).toMatchObject({
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

  it('applies auth defaults', () => {
    expect(validateEnv(base)).toMatchObject({
      STORE_MODE: 'cloud',
      SESSION_IDLE_TIMEOUT_MIN_SECONDS: 300,
      SESSION_IDLE_TIMEOUT_MAX_SECONDS: 43200,
      SESSION_ABSOLUTE_TTL_SECONDS: 43200,
      STEP_UP_MAX_AGE_SECONDS: 900,
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_SECONDS: 900,
      ACTIVATION_CODE_TTL_HOURS: 72,
      AUTH_TEST_COOKIES: false,
    });
  });

  it('converts PORT from a string', () => {
    expect(validateEnv({ ...base, PORT: '3001' }).PORT).toBe(3001);
  });

  it('rejects an unknown APP_ENV', () => {
    expect(() => validateEnv({ ...base, APP_ENV: 'staging' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('requires DATABASE_URL and PLATFORM_DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('converts DB_STATEMENT_TIMEOUT_MS from a string', () => {
    expect(
      validateEnv({ ...base, DB_STATEMENT_TIMEOUT_MS: '1500' })
        .DB_STATEMENT_TIMEOUT_MS,
    ).toBe(1500);
  });

  describe('auth configuration', () => {
    it('requires REDIS_URL in cloud mode', () => {
      const withoutRedis = without(base, 'REDIS_URL');
      expect(() => validateEnv(withoutRedis)).toThrow(/REDIS_URL/);
      expect(() =>
        validateEnv({ ...withoutRedis, STORE_MODE: 'cloud' }),
      ).toThrow(/REDIS_URL/);
    });

    it('does not require REDIS_URL in offline mode', () => {
      const withoutRedis = without(base, 'REDIS_URL');
      expect(
        validateEnv({ ...withoutRedis, STORE_MODE: 'offline' }).STORE_MODE,
      ).toBe('offline');
    });

    it('rejects a REDIS_URL that is not redis:// or rediss://', () => {
      expect(() =>
        validateEnv({ ...base, REDIS_URL: 'http://h:6379' }),
      ).toThrow(/REDIS_URL/);
      expect(
        validateEnv({ ...base, REDIS_URL: 'rediss://h:6380' }).REDIS_URL,
      ).toBe('rediss://h:6380');
    });

    it('rejects an unknown STORE_MODE', () => {
      expect(() => validateEnv({ ...base, STORE_MODE: 'hybrid' })).toThrow(
        /STORE_MODE/,
      );
    });

    it('requires the JWT key ring and the pepper ring', () => {
      const noKeys = without(base, 'SESSION_JWT_KEYS');
      const noPeppers = without(base, 'PASSWORD_PEPPERS');
      expect(() => validateEnv(noKeys)).toThrow(/SESSION_JWT_KEYS/);
      expect(() => validateEnv(noPeppers)).toThrow(/PASSWORD_PEPPERS/);
    });

    it('parses the key rings into the config', () => {
      const env = validateEnv(base);
      expect(env.jwtKeyRing.activeId).toBe('k1');
      expect(env.jwtKeyRing.keys.get('k1')?.length).toBe(32);
      expect(env.pepperRing.activeId).toBe('1');
      expect(env.pepperRing.keys.get('1')?.length).toBe(32);
    });

    it('rejects a JWT key shorter than 32 bytes without leaking it', () => {
      const short = randomBytes(16).toString('base64url');
      let message = '';
      try {
        validateEnv({ ...base, SESSION_JWT_KEYS: `k1:${short}` });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('SESSION_JWT_KEYS');
      expect(message).not.toContain(short);
    });

    it('rejects an active kid that is not in the ring', () => {
      expect(() =>
        validateEnv({ ...base, SESSION_JWT_ACTIVE_KID: 'k9' }),
      ).toThrow(/SESSION_JWT_ACTIVE_KID/);
    });

    it('requires pepper ids to be positive integers', () => {
      expect(() =>
        validateEnv({
          ...base,
          PASSWORD_PEPPERS: `v1:${secret()}`,
          PASSWORD_PEPPER_ACTIVE: 'v1',
        }),
      ).toThrow(/PASSWORD_PEPPER/);
      expect(() =>
        validateEnv({
          ...base,
          PASSWORD_PEPPERS: `0:${secret()}`,
          PASSWORD_PEPPER_ACTIVE: '0',
        }),
      ).toThrow(/PASSWORD_PEPPER/);
    });

    it('rejects AUTH_TEST_COOKIES=true outside APP_ENV=test', () => {
      expect(() => validateEnv({ ...base, AUTH_TEST_COOKIES: 'true' })).toThrow(
        /AUTH_TEST_COOKIES/,
      );
      expect(() =>
        validateEnv({ ...base, APP_ENV: 'prod', AUTH_TEST_COOKIES: 'true' }),
      ).toThrow(/AUTH_TEST_COOKIES/);
    });

    it('allows AUTH_TEST_COOKIES=true when APP_ENV=test', () => {
      expect(
        validateEnv({ ...base, APP_ENV: 'test', AUTH_TEST_COOKIES: 'true' })
          .AUTH_TEST_COOKIES,
      ).toBe(true);
    });

    it('parses AUTH_TEST_COOKIES=false from a string as false', () => {
      expect(
        validateEnv({ ...base, AUTH_TEST_COOKIES: 'false' }).AUTH_TEST_COOKIES,
      ).toBe(false);
    });

    it('rejects an idle timeout minimum above the maximum', () => {
      expect(() =>
        validateEnv({
          ...base,
          SESSION_IDLE_TIMEOUT_MIN_SECONDS: '600',
          SESSION_IDLE_TIMEOUT_MAX_SECONDS: '300',
        }),
      ).toThrow(/SESSION_IDLE_TIMEOUT/);
    });

    it('converts numeric limits from strings', () => {
      expect(
        validateEnv({
          ...base,
          LOGIN_MAX_FAILURES: '3',
          LOGIN_LOCK_SECONDS: '60',
        }),
      ).toMatchObject({
        LOGIN_MAX_FAILURES: 3,
        LOGIN_LOCK_SECONDS: 60,
      });
    });

    it('requires WEB_ORIGIN and ADMIN_ORIGIN as origins without a path', () => {
      const noWeb = without(base, 'WEB_ORIGIN');
      const noAdmin = without(base, 'ADMIN_ORIGIN');
      expect(() => validateEnv(noWeb)).toThrow(/WEB_ORIGIN/);
      expect(() => validateEnv(noAdmin)).toThrow(/ADMIN_ORIGIN/);
      expect(() =>
        validateEnv({ ...base, WEB_ORIGIN: 'http://localhost:4200/app' }),
      ).toThrow(/WEB_ORIGIN/);
      expect(() =>
        validateEnv({ ...base, ADMIN_ORIGIN: 'localhost:4300' }),
      ).toThrow(/ADMIN_ORIGIN/);
      expect(
        validateEnv({ ...base, WEB_ORIGIN: 'https://pharmacy.example' })
          .WEB_ORIGIN,
      ).toBe('https://pharmacy.example');
    });
  });
});
