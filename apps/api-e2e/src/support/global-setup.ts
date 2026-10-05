import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN_ORIGIN,
  API_BASE_URL,
  E2E_API_PORT,
  WEB_ORIGIN,
} from './env';

/* eslint-disable */
var __API_PROCESS__: ChildProcess | undefined;

// Variables the API and the seed read from the environment (Nx loads the root .env into this task).
// Only the names are checked and reported, never the values.
const REQUIRED_ENV = [
  'DATABASE_URL',
  'PLATFORM_DATABASE_URL',
  'REDIS_URL',
  'SESSION_JWT_KEYS',
  'SESSION_JWT_ACTIVE_KID',
  'PASSWORD_PEPPERS',
  'PASSWORD_PEPPER_ACTIVE',
];

const START_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const LOG_TAIL_LINES = 40;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// Starts the built API (`api:build` runs first, see project.json) as a child process with the
// environment of the auth e2e: APP_ENV=test (the only value that allows AUTH_TEST_COOKIES=true),
// plain `sid` cookies without Secure so tests run over http, and the origins the CSRF guard checks.
// Everything else (database and Redis URLs, JWT keys, peppers) comes from the process environment.
module.exports = async function () {
  console.log('\nSetting up...\n');

  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `api-e2e needs these variables in the environment (copy them from .env.example into .env): ${missing.join(', ')}`,
    );
  }

  const root = join(__dirname, '..', '..', '..', '..');
  const main = join(root, 'apps', 'api', 'dist', 'main.js');
  if (!existsSync(main)) {
    throw new Error('apps/api/dist/main.js is missing: run `npx nx build api`');
  }

  const child = spawn(process.execPath, [main], {
    cwd: root,
    env: {
      ...process.env,
      APP_ENV: 'test',
      AUTH_TEST_COOKIES: 'true',
      STORE_MODE: 'cloud',
      PORT: String(E2E_API_PORT),
      WEB_ORIGIN,
      ADMIN_ORIGIN,
      // The lock tests rely on these two values.
      LOGIN_MAX_FAILURES: '5',
      LOGIN_LOCK_SECONDS: '900',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  globalThis.__API_PROCESS__ = child;

  const tail: string[] = [];
  const collect = (chunk: Buffer) => {
    tail.push(...chunk.toString().split('\n').filter(Boolean));
    if (tail.length > LOG_TAIL_LINES) tail.splice(0, tail.length - LOG_TAIL_LINES);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!(await healthy())) {
    if (child.exitCode !== null) {
      throw new Error(
        `The API exited with code ${child.exitCode} during start-up:\n${tail.join('\n')}`,
      );
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(
        `The API did not answer ${API_BASE_URL}/api/v1/health in ${START_TIMEOUT_MS / 1000}s:\n${tail.join('\n')}`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // Hint: `globalThis` is shared with the global teardown.
  globalThis.__TEARDOWN_MESSAGE__ = '\nTearing down...\n';
};
