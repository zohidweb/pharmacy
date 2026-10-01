export interface TestDatabaseUrls {
  owner: string;
  app: string;
  platform: string;
  name: string;
}

const DEFAULT_TEST_DATABASE = 'pharmacy_test';

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required to run integration tests`);
  return value;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

// Maps the dev role URLs onto the dedicated test database, so tests never touch the dev data.
export function testDatabaseUrls(env: NodeJS.ProcessEnv): TestDatabaseUrls {
  const owner = requiredEnv(env, 'MIGRATION_DATABASE_URL');
  const app = requiredEnv(env, 'DATABASE_URL');
  const platform = requiredEnv(env, 'PLATFORM_DATABASE_URL');
  const name = env['TEST_DATABASE_NAME'] || DEFAULT_TEST_DATABASE;

  const devNames = [owner, app, platform].map((url) => new URL(url).pathname.slice(1));
  if (devNames.includes(name)) {
    throw new Error(`TEST_DATABASE_NAME (${name}) must differ from the dev database name`);
  }

  return {
    owner: withDatabase(owner, name),
    app: withDatabase(app, name),
    platform: withDatabase(platform, name),
    name,
  };
}
