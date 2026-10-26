#!/usr/bin/env node
// Build and run the Pharmacy stack per environment (CLAUDE.md, "Environments").
//
//   npm run stack -- <env> <command> [service...] [--skip-checks]
//
//   env:      dev | test | prod
//   commands: init    create the env file from its example with random passwords and keys (test, prod);
//                     on an existing file, append the variables the example gained since
//             build   quality gate (lint, test) + Docker images (the proxy image builds web/admin, ADR-0012)
//             up      start containers (detached) and wait until they are healthy
//             down    stop containers (data volumes are kept)
//             ps      container status
//             logs    follow logs (optionally of given services)
//   backups (test, prod; ADR-0019 — the `backup` service of docker/compose.backup.yml):
//             backup                       take a verified copy now
//             backup-status                the copies, the newest verified one, the next copy
//             backup-verify <copy>         restore a copy into a scratch instance again (a drill)
//             restore <copy> [--replace-database]
//                                          without the flag: what would happen; with it: restore the copy beside
//                                          the working database, swap the names, reset sessions, start everything
//   copies off the host (test, prod; ADR-0020 — BACKUP_OFFSITE_BUCKET and the rclone variables of the env file):
//             offsite-list                 the copies and the env files in the bucket, with their older versions
//             offsite-fetch <copy> --identity <key file>
//                                          the server is lost: the copy back from the bucket into BACKUP_DIR (the
//                                          private key of a keeper goes on stdin), then `restore <copy>`
//             offsite-verify <copy> --identity <key file>
//                                          the monthly drill: download, decrypt and restore into a scratch instance
//             env-push                     the env file of the environment, encrypted for the keepers, into the bucket
//             --at <UTC time>              offsite-list, -fetch, -verify: the bucket as it was then (after a break-in,
//                                          a time before it), e.g. --at 2026-10-20T21:00:00Z
//
// Checks run manually until CI/CD is chosen by an ADR (CLAUDE.md, "CI/CD").
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ENVS = {
  dev: { envFile: '.env', example: '.env.example', project: 'pharmacy-dev' },
  test: { envFile: 'docker/env/test.env', example: 'docker/env/test.env.example', project: 'pharmacy-test' },
  prod: { envFile: 'docker/env/prod.env', example: 'docker/env/prod.env.example', project: 'pharmacy-prod' },
};
const BACKUP_COMMANDS = [
  'backup',
  'backup-status',
  'backup-verify',
  'restore',
  'offsite-list',
  'offsite-fetch',
  'offsite-verify',
  'env-push',
];
const COMMANDS = ['init', 'build', 'up', 'down', 'ps', 'logs', ...BACKUP_COMMANDS];
// Environments with the backup service (ADR-0019); their env files need these variables.
const BACKUP_ENVS = ['test', 'prod'];
const BACKUP_VARIABLES = ['PHARMACY_BACKUP_PASSWORD', 'BACKUP_DIR'];
// A copy is named by its UTC start time; the strict pattern also keeps the argument safe for cmd.exe (shell: true).
const COPY_NAME = /^\d{8}T\d{6}Z$/;
// --at of the commands off the host, as strict for the same reason.
const AT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// Commands that build or start the stack refuse the placeholders of the example in a test or prod env file (security
// review 2026-10-22, S2): a hand-copied example would run PostgreSQL, the roles and Redis with the password `change-me`.
const STARTING_COMMANDS = ['build', 'up', 'restore'];
const PLACEHOLDER = /change-me|generate-key/;
const MIN_PASSWORD_LENGTH = 16;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  console.log(`\n$ ${[cmd, ...args].join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) fail(`Command failed (exit ${result.status}): ${cmd} ${args.join(' ')}`);
  return result;
}

// Like run, but returns the exit status instead of failing.
function runStatus(cmd, args) {
  console.log(`\n$ ${[cmd, ...args].join(' ')}`);
  return spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status;
}

// The variables whose example value is a placeholder: missing from the env file, or still holding a placeholder, or a
// password of the example (`change-me`) shorter than MIN_PASSWORD_LENGTH. Names only, values are never printed.
function weakSecrets(env) {
  const result = { missing: [], weak: [] };
  for (const line of readFileSync(join(root, env.example), 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match === null || !PLACEHOLDER.test(match[2])) continue;
    const [, name, example] = match;
    const value = envValue(env, name, '');
    if (value === '') result.missing.push(name);
    else if (PLACEHOLDER.test(value) || (example.includes('change-me') && value.length < MIN_PASSWORD_LENGTH)) {
      result.weak.push(name);
    }
  }
  return result;
}

// A variable of the shell or the env file (compose gives the shell precedence), never printed. The file is read as
// compose reads it: the last definition wins, `export ` and spaces around `=` are allowed, a quoted value loses its
// quotes and an unquoted one its ` # comment`.
function envValue(env, name, fallback) {
  if (process.env[name]) return process.env[name];
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  const raw = readFileSync(join(root, env.envFile), 'utf8')
    .split(/\r?\n/)
    .map((line) => pattern.exec(line)?.[1])
    .findLast((value) => value !== undefined);
  if (raw === undefined) return fallback;
  const quoted = /^(["'])(.*)\1\s*(?:#.*)?$/.exec(raw);
  return quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function imageTag(envName) {
  if (envName === 'dev') return 'local';
  const sha = capture('git', ['rev-parse', '--short', 'HEAD']);
  if (!sha) fail('Cannot determine git revision for the image tag.');
  const dirty = capture('git', ['status', '--porcelain']) !== '';
  if (envName === 'prod' && dirty) {
    fail('prod images are built only from a clean working tree — commit or stash your changes first.');
  }
  return dirty ? `${sha}-dirty` : sha;
}

function composeArgs(envName, env) {
  return [
    'compose',
    '--project-name', env.project,
    '--env-file', env.envFile,
    '-f', 'docker/compose.yml',
    ...(BACKUP_ENVS.includes(envName) ? ['-f', 'docker/compose.backup.yml'] : []),
    '-f', `docker/compose.${envName}.yml`,
  ];
}

// test/prod: PostgreSQL first, then the backup role (04-backup-role.sql creates pharmacy_backup on an existing
// cluster and applies a changed PHARMACY_BACKUP_PASSWORD; ADR-0019), then the rest. dev rebuilds local images on
// the fly; test/prod start exactly the images made by `build`.
function up(envName, env, services) {
  const compose = composeArgs(envName, env);
  if (envName === 'dev') {
    run('docker', [...compose, 'up', '-d', '--build', '--wait', ...services]);
  } else {
    run('docker', [...compose, 'up', '-d', '--no-build', '--wait', 'postgres']);
    run('docker', [
      ...compose, 'exec', '-T', 'postgres',
      'psql', '-q', '-v', 'ON_ERROR_STOP=1',
      '-U', envValue(env, 'POSTGRES_SUPERUSER', 'postgres'),
      '-d', envValue(env, 'POSTGRES_DB', 'pharmacy'),
      '-f', '/docker-entrypoint-initdb.d/04-backup-role.sql',
    ]);
    run('docker', [...compose, 'up', '-d', '--no-build', '--wait', ...services]);
  }
  run('docker', [...compose, 'ps']);
}

function copyName(name, usage) {
  if (!COPY_NAME.test(name ?? '')) fail(`Usage: ${usage} — copy names are listed by backup-status (e.g. 20261021T210000Z).`);
  return name;
}

function backup(envName, env) {
  const status = runStatus('docker', [...composeArgs(envName, env), 'exec', '-T', 'backup', 'pharmacy-backup', 'run']);
  if (status === 0) console.log(`\n✔ ${envName}: the copy is taken and verified.`);
  else if (status === 2) fail(`No copy taken — blocked, the reason is above (npm run stack -- ${envName} backup-status).`);
  else if (status === 3) fail('A copy is already running; try again when it ends.');
  else fail(`The copy failed (exit ${status}); see the output above and npm run stack -- ${envName} backup-status.`);
}

// Restore (spec 2026-10-21-db-backups-design.md, B9). The copy is checked first; with --replace-database api and
// backup stop, the postgres container restores the copy beside the working database and swaps the names, Redis
// restarts (no persistence: all sessions are reset), and `up` starts everything, migrating a copy older than the code.
function restore(envName, env, name, replace) {
  const compose = composeArgs(envName, env);
  const inPostgres = [...compose, 'exec', '-T', '-u', 'postgres', '-e', 'TZ=Asia/Dushanbe', 'postgres', 'pharmacy-backup'];
  run('docker', [...inPostgres, 'restore', name, '--check']);
  if (!replace) {
    console.log(
      `\nNothing changed. With --replace-database: api and backup stop, the copy is restored beside the working database,` +
        `\nthe names are swapped (the previous database is kept), Redis restarts — all sessions are reset — and the stack starts.`,
    );
    return;
  }
  run('docker', [...compose, 'stop', 'api', 'backup']);
  if (runStatus('docker', [...inPostgres, 'restore', name]) !== 0) {
    run('docker', [...compose, 'up', '-d', '--no-build', '--wait', 'api', 'backup']);
    fail(`Restore of ${name} failed; the working database is untouched, api and backup run again.`);
  }
  run('docker', [...compose, 'restart', 'redis']);
  up(envName, env, []);
  const old = `${envValue(env, 'POSTGRES_DB', 'pharmacy')}_before_${name.toLowerCase()}`;
  const drop = [...compose, 'exec', '-T', 'postgres', 'psql', '-U', envValue(env, 'POSTGRES_SUPERUSER', 'postgres')];
  console.log(`\n✔ ${envName}: the database is restored from copy ${name}. All sessions are reset — everyone signs in again.`);
  console.log(`  The previous database is kept as ${old} (no connections allowed). Drop it when it is no longer needed:`);
  console.log(`    docker ${drop.join(' ')} -d postgres -c "drop database ${old}"`);
  console.log('  Passwords and PINs work only with the password pepper of the copy (PASSWORD_PEPPERS, ADR-0008):');
  console.log('  the env file is not in the copies and is restored from its own backup.');
}

// Copies off the host (ADR-0020, spec 2026-10-23-offsite-backups). `run --no-deps` rather than `exec`: after the loss
// of the server only postgres is up, and the backup service may not run yet.
const OFFSITE_VARIABLES = [
  'APP_ENV',
  'BACKUP_OFFSITE_BUCKET',
  'BACKUP_AGE_RECIPIENTS',
  'RCLONE_CONFIG_OFFSITE_TYPE',
  'RCLONE_CONFIG_OFFSITE_PROVIDER',
  'RCLONE_CONFIG_OFFSITE_ENDPOINT',
  'RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID',
  'RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY',
  'RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE',
];

function requireOffsite(envName, env, command) {
  if (!envValue(env, 'BACKUP_OFFSITE_BUCKET', '')) {
    fail(`${command}: ${env.envFile} has no BACKUP_OFFSITE_BUCKET — copies off the host are not configured (ADR-0020).`);
  }
}

// --at <UTC time> as arguments of pharmacy-backup, or none.
function atArgs(at) {
  if (at === undefined) return [];
  if (!AT_TIME.test(at)) fail('--at takes a UTC time such as 2026-10-20T21:00:00Z.');
  return ['--at', at];
}

// fetch | verify-offsite <copy>: the private key of a keeper reaches the container on stdin only (spec O11) — never on
// a command line, in a log or on the disk of the host.
function offsiteWithKey(envName, env, command, name, identity, at) {
  const label = `offsite-${command === 'fetch' ? 'fetch' : 'verify'}`;
  requireOffsite(envName, env, label);
  if (!identity || !existsSync(identity)) {
    fail(`${label}: --identity <file of the private key of a keeper> is required.`);
  }
  const args = [
    ...composeArgs(envName, env), 'run', '--rm', '--no-deps', '-T', 'backup', 'pharmacy-backup', command, name, ...atArgs(at),
  ];
  console.log(`\n$ docker ${args.join(' ')} < <private key>`);
  const result = spawnSync('docker', args, {
    cwd: root,
    input: readFileSync(identity),
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) fail(`${label} ${name} failed (exit ${result.status}); the reason is above.`);
}

// env-push: the env file of the environment, encrypted for the keepers, into the bucket (spec O13). It runs on the
// machine of the architect, beside the env file, in the image built for this commit; the values reach the container
// through the environment of docker, never on its command line.
function envPush(envName, env) {
  requireOffsite(envName, env, 'env-push');
  const values = Object.fromEntries(OFFSITE_VARIABLES.map((name) => [name, envValue(env, name, '')]));
  // APP_ENV is the prefix of the object: an APP_ENV of the shell must not send prod's file under dev/.
  values.APP_ENV = envName;
  const args = [
    'run', '--rm', '-i', '--pull=never', '--user', 'postgres',
    ...OFFSITE_VARIABLES.flatMap((name) => ['-e', name]),
    // The fixed values of docker/compose.backup.yml.
    '-e', 'RCLONE_CONFIG=/tmp/rclone.conf', '-e', 'RCLONE_CACHE_DIR=/tmp/rclone-cache',
    '-e', 'RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true', '-e', 'RCLONE_CONFIG_OFFSITE_UPLOAD_CUTOFF=5G',
    `pharmacy/postgres:${process.env.IMAGE_TAG}`, 'pharmacy-backup', 'env-push',
  ];
  console.log(`\n$ docker ${args.join(' ')} < ${env.envFile}`);
  const result = spawnSync('docker', args, {
    cwd: root,
    input: readFileSync(join(root, env.envFile)),
    env: { ...process.env, ...values },
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) fail(`env-push failed (exit ${result.status}); the reason is above.`);
}

function init(envName, env) {
  if (envName === 'dev') fail('dev uses the root .env — copy it from .env.example.');
  const target = join(root, env.envFile);
  // `generate-key` placeholders (JWT keys, password peppers) get 32 random bytes; passwords get 18.
  const content = readFileSync(join(root, env.example), 'utf8')
    .replace(/generate-key/g, () => randomBytes(32).toString('base64url'))
    .replace(/change-me/g, () => randomBytes(18).toString('base64url'));
  if (!existsSync(target)) {
    writeFileSync(target, content, { mode: 0o600 });
    console.log(`✔ Created ${env.envFile} with random passwords and keys. Keep it out of git and chats.`);
    return;
  }
  // A file of an earlier init: the variables the example gained since are appended, with fresh
  // random values for their placeholders. Existing variables are never changed; names only are
  // printed, never values.
  const current = readFileSync(target, 'utf8');
  const defined = new Set(
    [...current.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]),
  );
  const missing = content.split(/\r?\n/).filter((line) => {
    const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    return name !== undefined && !defined.has(name);
  });
  if (missing.length === 0) {
    console.log(`✔ ${env.envFile} already has every variable of ${env.example}; nothing changed.`);
    return;
  }
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  appendFileSync(target, `${separator}${missing.join('\n')}\n`);
  const names = missing.map((line) => line.slice(0, line.indexOf('=')));
  console.log(`✔ Added to ${env.envFile}: ${names.join(', ')}.`);
}

function build(envName, env, skipChecks) {
  const nx = ['nx'];
  if (!skipChecks) {
    run('npx', [...nx, 'run-many', '-t', 'lint', 'test', '--outputStyle=static']);
  } else {
    console.log('\n⚠ Quality gate skipped (--skip-checks).');
  }
  // The static exports of web/admin are built inside the proxy image (docker/proxy/Dockerfile, ADR-0012), never with
  // the API mocks: the flag is pinned off there and a bundle that still carries them stops the build (F1).
  run('docker', [...composeArgs(envName, env), 'build']);
  console.log(`\n✔ ${envName}: images tagged ${process.env.IMAGE_TAG} (api, postgres, redis, proxy with web/admin)`);
}

const [envName, command, ...rest] = process.argv.slice(2);
const env = ENVS[envName];
if (!env || !COMMANDS.includes(command)) {
  fail(`Usage: npm run stack -- <${Object.keys(ENVS).join('|')}> <${COMMANDS.join('|')}> [service...] [--skip-checks]`);
}
const skipChecks = rest.includes('--skip-checks');
const services = rest.filter((a) => !a.startsWith('--'));

if (command === 'init') {
  init(envName, env);
  process.exit(0);
}
if (!existsSync(join(root, env.envFile))) {
  fail(`${relative(root, join(root, env.envFile))} not found. Run: npm run stack -- ${envName} init`);
}
if (envName === 'prod' && skipChecks) fail('--skip-checks is not allowed for prod.');
if (BACKUP_COMMANDS.includes(command) && !BACKUP_ENVS.includes(envName)) {
  fail(`${command}: backups exist in ${BACKUP_ENVS.join(' and ')} only (ADR-0019).`);
}
if (BACKUP_ENVS.includes(envName)) {
  const missing = BACKUP_VARIABLES.filter((name) => !envValue(env, name, ''));
  if (missing.length > 0) {
    fail(`${env.envFile} lacks ${missing.join(', ')} (backups, ADR-0019). Run: npm run stack -- ${envName} init, then set BACKUP_DIR.`);
  }
}
if (BACKUP_ENVS.includes(envName) && STARTING_COMMANDS.includes(command)) {
  const { missing, weak } = weakSecrets(env);
  const problems = [];
  if (missing.length > 0) {
    problems.push(`${env.envFile} lacks ${missing.join(', ')}: \`npm run stack -- ${envName} init\` appends them with random values.`);
  }
  if (weak.length > 0) {
    problems.push(
      `${env.envFile}: ${weak.join(', ')} still hold a placeholder of ${env.example} or a password shorter than ` +
        `${MIN_PASSWORD_LENGTH} characters. Replace only these with random values (passwords — ${MIN_PASSWORD_LENGTH}+ ` +
        `characters, keys — 32 bytes base64url). On a database that has data a new role password also needs ` +
        `ALTER ROLE … PASSWORD by the superuser (test may recreate its volume), and a new pepper voids every password ` +
        `and PIN: a new env file from \`init\` is for a new stack only.`,
    );
  }
  if (problems.length > 0) fail(problems.join('\n  '));
}
if (envName === 'prod' && STARTING_COMMANDS.includes(command) && !envValue(env, 'BACKUP_OFFSITE_BUCKET', '')) {
  console.warn(
    `\n⚠ ${env.envFile} has no BACKUP_OFFSITE_BUCKET: the copies of the database stay on this host only — no real data ` +
      'before the copies go off the host (decision 7.1 of the security review, ADR-0020); the backup service turns ' +
      'unhealthy 2 h after its start.',
  );
}
const option = (name) => (rest.includes(name) ? (rest[rest.indexOf(name) + 1] ?? '') : undefined);
const identity = option('--identity');
const at = option('--at');

process.env.IMAGE_TAG = imageTag(envName);

switch (command) {
  case 'build':
    build(envName, env, skipChecks);
    break;
  case 'up':
    up(envName, env, services);
    break;
  case 'backup':
    backup(envName, env);
    break;
  case 'backup-status':
    run('docker', [...composeArgs(envName, env), 'exec', '-T', '-u', 'postgres', '-e', 'TZ=Asia/Dushanbe', 'postgres', 'pharmacy-backup', 'status']);
    break;
  case 'offsite-list':
    requireOffsite(envName, env, command);
    run('docker', [
      ...composeArgs(envName, env), 'run', '--rm', '--no-deps', '-T', 'backup', 'pharmacy-backup', 'list-offsite', ...atArgs(at),
    ]);
    break;
  case 'offsite-fetch':
  case 'offsite-verify':
    offsiteWithKey(
      envName,
      env,
      command === 'offsite-fetch' ? 'fetch' : 'verify-offsite',
      copyName(services[0], `npm run stack -- ${envName} ${command} <copy> --identity <key file> [--at <UTC time>]`),
      identity,
      at,
    );
    break;
  case 'env-push':
    envPush(envName, env);
    break;
  case 'backup-verify':
    run('docker', [
      ...composeArgs(envName, env), 'exec', '-T', 'backup', 'pharmacy-backup', 'verify',
      copyName(services[0], `npm run stack -- ${envName} backup-verify <copy>`),
    ]);
    break;
  case 'restore':
    restore(
      envName,
      env,
      copyName(services[0], `npm run stack -- ${envName} restore <copy> [--replace-database]`),
      rest.includes('--replace-database'),
    );
    break;
  case 'down':
    run('docker', [...composeArgs(envName, env), 'down', ...services]);
    break;
  case 'ps':
    run('docker', [...composeArgs(envName, env), 'ps']);
    break;
  case 'logs':
    run('docker', [...composeArgs(envName, env), 'logs', '-f', '--tail=200', ...services]);
    break;
}
