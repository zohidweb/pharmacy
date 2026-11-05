// The API of the load run (plan R8, R9): the built apps/api/dist/main.js on its own port, production defaults, the
// database pharmacy_load and the logical Redis database 13, flushed before the start. Plus the HTTP helper of the run:
// the Origin of the web client (CSRF), JSON, a correlation id, the cookies of one employee or terminal.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from 'redis';
import { ROOT, loadEnv } from './env.mjs';

const MAIN = join(ROOT, 'apps', 'api', 'dist', 'main.js');

/** A UUIDv7 (RFC 9562) as the POS makes them: the id and the idempotency key of an operation. */
export function uuidv7(now = Date.now()) {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The cookies of one employee or terminal: what Set-Cookie gave, sent back as Cookie. */
export class CookieJar {
  constructor(initial = {}) {
    this.cookies = { ...initial };
  }

  take(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const name = pair.slice(0, pair.indexOf('=')).trim();
      const value = pair.slice(pair.indexOf('=') + 1).trim();
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) delete this.cookies[name];
      else this.cookies[name] = value;
    }
  }

  header() {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  get(name) {
    return this.cookies[name];
  }
}

/**
 * One request of the run: `{ status, body, ms }`. Never throws on a status — the caller decides; the body of an error
 * is the problem+json of the API (no secrets: the API does not echo them).
 */
export async function call(api, method, path, { jar, body, headers = {} } = {}) {
  const started = performance.now();
  const response = await fetch(`${api.url}/api/v1${path}`, {
    method,
    headers: {
      Origin: api.origin,
      'X-Correlation-Id': randomUUID(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(jar ? { Cookie: jar.header() } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar?.take(response);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, ms: performance.now() - started };
}

/** The request or a thrown error naming the route, the status and the problem code. */
export async function expect(api, method, path, options, ...statuses) {
  const result = await call(api, method, path, options);
  if (!statuses.includes(result.status)) {
    const code = result.body && typeof result.body === 'object' ? (result.body.code ?? result.body.title) : '';
    throw new Error(`${method} ${path}: ${result.status} ${code ?? ''}`.trim());
  }
  return result;
}

async function healthy(url) {
  try {
    const response = await fetch(`${url}/api/v1/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/** The Node image of apps/api/Dockerfile (the same digest) and the network of `npm run dev:deps`. */
export const NODE_IMAGE = process.env.LOAD_NODE_IMAGE ?? 'node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1';
export const DOCKER_NETWORK = process.env.LOAD_DOCKER_NETWORK ?? 'pharmacy-dev_default';
const CONTAINER = 'pharmacy-load-api';

/**
 * The command of the API. `docker` (the default): the built bundle in a container of the production Node image on the
 * network of PostgreSQL and Redis, as in the compose of test and prod — a query costs ≈ 0.2 ms there, while from
 * Windows through the port of Docker Desktop it costs ≈ 3 ms and a receipt makes dozens of them. `host`: the bundle
 * on this PC, for a comparison. The values of the environment reach `docker run` through its own environment
 * (`-e NAME`), never its arguments.
 */
function apiCommand(mode, env, port) {
  if (mode === 'host') return { command: process.execPath, args: [MAIN], env };
  const inner = { ...env, PORT: '3000' };
  for (const [key, host] of [
    ['DATABASE_URL', 'postgres:5432'],
    ['PLATFORM_DATABASE_URL', 'postgres:5432'],
    ['MIGRATION_DATABASE_URL', 'postgres:5432'],
    ['REDIS_URL', 'redis:6379'],
  ]) {
    const url = new URL(inner[key]);
    url.host = host;
    inner[key] = url.toString();
  }
  // what the API reads (apps/api/src/app/config/env.validation.ts); the other knobs keep their production defaults
  const names = [
    'NODE_ENV', 'APP_ENV', 'AUTH_TEST_COOKIES', 'PORT', 'DATABASE_URL', 'PLATFORM_DATABASE_URL', 'REDIS_URL',
    'SESSION_JWT_KEYS', 'SESSION_JWT_ACTIVE_KID', 'PASSWORD_PEPPERS', 'PASSWORD_PEPPER_ACTIVE',
    'WEB_ORIGIN', 'ADMIN_ORIGIN', 'SITE_ORIGIN',
  ];
  return {
    command: 'docker',
    args: [
      'run', '--rm', '--name', CONTAINER, '--network', DOCKER_NETWORK, '-p', `127.0.0.1:${port}:3000`,
      '-v', `${ROOT}:/app:ro`, '-w', '/app', ...names.flatMap((name) => ['-e', name]),
      NODE_IMAGE, 'node', 'apps/api/dist/main.js',
    ],
    env: { ...process.env, ...inner },
  };
}

/**
 * Starts the API of the run: Redis 13 flushed (no session, lock or limit of an earlier run), the bundle answering on
 * `port`, its output in `logFile`. Resolves when /health answers; `stop()` ends it.
 */
export async function startApi({ port = 3010, logFile, mode = 'docker' } = {}) {
  if (!existsSync(MAIN)) throw new Error('apps/api/dist/main.js is missing: npx nx build api');
  const env = loadEnv({ apiPort: port });
  const url = `http://127.0.0.1:${port}`;
  if (await healthy(url)) throw new Error(`port ${port} already answers: stop that API first`);

  const redis = createClient({ url: env.REDIS_URL });
  await redis.connect();
  await redis.flushDb();
  await redis.quit();

  const docker = (...args) => new Promise((resolve) => spawn('docker', args, { stdio: 'ignore' }).on('exit', resolve));
  if (mode === 'docker') await docker('rm', '-f', CONTAINER);
  const run = apiCommand(mode, env, port);
  const child = spawn(run.command, run.args, { cwd: ROOT, env: run.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
  child.stdout.on('data', (chunk) => log?.write(chunk));
  child.stderr.on('data', (chunk) => log?.write(chunk));
  let exited = null;
  child.on('exit', (code) => {
    exited = code;
  });
  // the container stops by its name: killing the attached `docker run` would leave it running
  const stop = async () => {
    if (exited !== null) return;
    const done = new Promise((resolve) => child.once('exit', resolve));
    if (mode === 'docker') await docker('stop', '-t', '10', CONTAINER);
    else child.kill();
    await done;
    log?.end();
  };

  // the bundle reads node_modules over the bind mount of Docker Desktop: the first start takes a while
  for (let waited = 0; !(await healthy(url)); waited += 250) {
    if (exited !== null) throw new Error(`the API exited with ${exited} at start${logFile ? ` (${logFile})` : ''}`);
    if (waited > 180_000) {
      await stop();
      throw new Error('the API did not answer /health in 3 minutes');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // the address of the API on the network of Docker, for the driver of the scenarios (driver.mjs)
  const internalUrl = mode === 'docker' ? `http://${CONTAINER}:3000` : `http://host.docker.internal:${port}`;
  return { url, internalUrl, origin: env.WEB_ORIGIN, pid: child.pid, mode, stop };
}
