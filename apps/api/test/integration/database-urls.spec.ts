import { testDatabaseUrls } from './database-urls';

const env = {
  DATABASE_URL: 'postgres://pharmacy_app:a@127.0.0.1:5432/pharmacy',
  PLATFORM_DATABASE_URL: 'postgres://pharmacy_platform:p@127.0.0.1:5432/pharmacy',
  MIGRATION_DATABASE_URL: 'postgres://pharmacy_owner:o@127.0.0.1:5432/pharmacy',
};

describe('testDatabaseUrls', () => {
  it('points every role at the test database', () => {
    const urls = testDatabaseUrls(env);
    expect(urls.name).toBe('pharmacy_test');
    expect(new URL(urls.app).pathname).toBe('/pharmacy_test');
    expect(new URL(urls.platform).pathname).toBe('/pharmacy_test');
    expect(new URL(urls.owner).pathname).toBe('/pharmacy_test');
    expect(new URL(urls.owner).username).toBe('pharmacy_owner');
  });

  it('honours TEST_DATABASE_NAME', () => {
    const urls = testDatabaseUrls({ ...env, TEST_DATABASE_NAME: 'pharmacy_ci_test' });
    expect(urls.name).toBe('pharmacy_ci_test');
    expect(new URL(urls.app).pathname).toBe('/pharmacy_ci_test');
  });

  it('rejects a test database equal to the dev database', () => {
    expect(() => testDatabaseUrls({ ...env, TEST_DATABASE_NAME: 'pharmacy' })).toThrow(/must differ/);
  });

  it('rejects a test database name not ending in _test', () => {
    expect(() => testDatabaseUrls({ ...env, TEST_DATABASE_NAME: 'postgres' })).toThrow(/_test/);
    expect(() => testDatabaseUrls({ ...env, TEST_DATABASE_NAME: 'Pharmacy_Test' })).toThrow(/_test/);
    expect(() => testDatabaseUrls({ ...env, TEST_DATABASE_NAME: 'x"; drop_test' })).toThrow(/_test/);
  });

  it('rejects a DATABASE_URL without a database name', () => {
    expect(() => testDatabaseUrls({ ...env, DATABASE_URL: 'postgres://pharmacy_app:a@127.0.0.1:5432' })).toThrow(
      /DATABASE_URL must include a database name/,
    );
    expect(() => testDatabaseUrls({ ...env, MIGRATION_DATABASE_URL: 'postgres://pharmacy_owner:o@127.0.0.1:5432/' })).toThrow(
      /MIGRATION_DATABASE_URL must include a database name/,
    );
  });

  it('compares decoded dev database names', () => {
    expect(() =>
      testDatabaseUrls({ ...env, DATABASE_URL: 'postgres://pharmacy_app:a@127.0.0.1:5432/pharmacy%5Ftest', TEST_DATABASE_NAME: 'pharmacy_test' }),
    ).toThrow(/must differ/);
  });

  it('fails when a URL is missing', () => {
    expect(() => testDatabaseUrls({ ...env, PLATFORM_DATABASE_URL: undefined })).toThrow(/PLATFORM_DATABASE_URL/);
  });
});
