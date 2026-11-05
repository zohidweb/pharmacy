// The environment of the POS load run (ADR-0009, axis Ж; docs/guides/load-test.md): the database pharmacy_load and
// the logical Redis database 13 of the dev containers, never the dev database, pharmacy_test, a stand or prod.
// The values of .env (passwords, JWT keys, pepper) are read here and never printed.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOAD_DB = 'pharmacy_load';
export const REDIS_DB = 13;
export const STATE_DIR = join(ROOT, 'tools', 'load', '.state');
export const RESULTS_DIR = join(ROOT, 'tools', 'load', 'results');
/** The PostgreSQL container of `npm run dev:deps` (compose project pharmacy-dev). */
export const PG_CONTAINER = process.env.LOAD_PG_CONTAINER ?? 'pharmacy-dev-postgres-1';

/** The dev .env: LOAD_ENV_FILE when the run starts from a worktree without its own .env. */
function devEnv() {
  const file = process.env.LOAD_ENV_FILE ?? join(ROOT, '.env');
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return env;
}

const DB_URLS = ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'MIGRATION_DATABASE_URL'];

/** Stops the run when a connection string would reach anything but pharmacy_load and Redis 13. */
export function assertLoadTargets(env) {
  for (const key of DB_URLS) {
    const name = decodeURIComponent(new URL(env[key]).pathname.slice(1));
    if (name !== LOAD_DB) {
      throw new Error(`${key} points to the database "${name}", the load run works only with ${LOAD_DB}`);
    }
  }
  if (new URL(env.REDIS_URL).pathname !== `/${REDIS_DB}`) {
    throw new Error(`REDIS_URL is not the logical database ${REDIS_DB}`);
  }
}

/**
 * The environment of the API and the scripts of the run: the dev .env with the database renamed to pharmacy_load and
 * Redis moved to the database 13, production defaults otherwise (plan R9): NODE_ENV=production, APP_ENV=test and
 * AUTH_TEST_COOKIES=true only for the names of the cookies (`sid`, `term` over http://).
 */
export function loadEnv({ apiPort = 3010 } = {}) {
  const dev = devEnv();
  const env = { ...process.env, ...dev };
  for (const key of DB_URLS) {
    if (!env[key]) throw new Error(`${key} is missing in the dev .env (see CLAUDE.md, «Local development secrets»)`);
    const url = new URL(env[key]);
    url.pathname = `/${LOAD_DB}`;
    env[key] = url.toString();
  }
  const redis = new URL(env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  redis.pathname = `/${REDIS_DB}`;
  env.REDIS_URL = redis.toString();
  Object.assign(env, {
    PORT: String(apiPort),
    NODE_ENV: 'production',
    APP_ENV: 'test',
    AUTH_TEST_COOKIES: 'true',
    SITE_ORIGIN: env.SITE_ORIGIN ?? 'http://127.0.0.1:4400',
  });
  // dev-only knobs of the .env must not tune the run away from the production defaults
  for (const key of ['DB_POOL_MAX', 'PLATFORM_DB_POOL_MAX', 'NODE_OPTIONS', 'OFFLINE_SYNC_ENABLED']) delete env[key];
  assertLoadTargets(env);
  return env;
}

/** The superuser of the dev cluster (POSTGRES_SUPERUSER of the dev .env). */
function superuser() {
  const user = devEnv().POSTGRES_SUPERUSER;
  if (!user) throw new Error('POSTGRES_SUPERUSER is missing in the dev .env');
  return user;
}

/**
 * Runs SQL as the superuser of the dev container through `docker exec … psql`, the text on stdin: `{ sql }` or
 * `{ file }`. `vars` become `-v name=value`; `database` is pharmacy_load unless the lifecycle needs `postgres`.
 * With `echo` the output goes to the console as it comes (the progress of the generator). Resolves with stdout.
 */
export function psql(input, vars = {}, { database = LOAD_DB, echo = false, args = [] } = {}) {
  if (database !== LOAD_DB && database !== 'postgres') {
    return Promise.reject(new Error(`psql runs only in ${LOAD_DB} (or postgres for create/drop)`));
  }
  const text = 'file' in input ? readFileSync(input.file, 'utf8') : input.sql;
  const argv = ['exec', '-i', PG_CONTAINER, 'psql', '-X', '-q', '-U', superuser(), '-d', database];
  argv.push('-v', 'ON_ERROR_STOP=1', ...args);
  for (const [name, value] of Object.entries(vars)) argv.push('-v', `${name}=${value}`);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (echo) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
      if (echo) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`psql exited with ${code}${echo ? '' : `:\n${err.trim()}`}`)),
    );
    child.stdin.end(text);
  });
}
