#!/usr/bin/env node
// Build and run the Pharmacy stack per environment (CLAUDE.md, "Environments").
//
//   npm run stack -- <env> <command> [service...] [--skip-checks]
//
//   env:      dev | test | prod
//   commands: init    create the env file from its example with random passwords and keys (test, prod);
//                     on an existing file, append the variables the example gained since
//             build   quality gate (lint, test, build) + static web/admin + Docker images
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
//
// Checks run manually until CI/CD is chosen by an ADR (CLAUDE.md, "CI/CD").
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendBuildProblem } from './frontend-mocks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ENVS = {
  dev: { envFile: '.env', example: '.env.example', project: 'pharmacy-dev' },
  test: { envFile: 'docker/env/test.env', example: 'docker/env/test.env.example', project: 'pharmacy-test' },
  prod: { envFile: 'docker/env/prod.env', example: 'docker/env/prod.env.example', project: 'pharmacy-prod' },
};
const COMMANDS = ['init', 'build', 'up', 'down', 'ps', 'logs', 'backup', 'backup-status', 'backup-verify', 'restore'];
const BACKUP_COMMANDS = ['backup', 'backup-status', 'backup-verify', 'restore'];
// Environments with the backup service (ADR-0019); their env files need these variables.
const BACKUP_ENVS = ['test', 'prod'];
const BACKUP_VARIABLES = ['PHARMACY_BACKUP_PASSWORD', 'BACKUP_DIR'];
// A copy is named by its UTC start time; the strict pattern also keeps the argument safe for cmd.exe (shell: true).
const COPY_NAME = /^\d{8}T\d{6}Z$/;

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

// A variable of the shell or the env file (compose gives the shell precedence), never printed.
function envValue(env, name, fallback) {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(join(root, env.envFile), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : fallback;
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
  // Static export of the frontends: apps/web/out, apps/admin/out (served after the reverse-proxy ADR, future ADR-0012).
  // Never with the API mocks (security review 2026-10-22, F1): the flag is pinned off, it is an input of the Nx build
  // (a cached mock build is not restored; `out` is a cached output of both apps), and a missing export or a bundle
  // that still carries the mocks stops the build.
  run('npx', [...nx, 'run-many', '-t', 'build', '-p', 'web', 'admin', '--outputStyle=static'], {
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_API_MOCKS: 'false' },
  });
  const problem = frontendBuildProblem(root);
  if (problem) fail(`${problem}.`);
  run('docker', [...composeArgs(envName, env), 'build']);
  console.log(`\n✔ ${envName}: images tagged ${process.env.IMAGE_TAG}; static web/admin in apps/*/out`);
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
