#!/usr/bin/env node
// Build and run the Pharmacy stack per environment (CLAUDE.md, "Environments").
//
//   npm run stack -- <env> <command> [service...] [--skip-checks]
//
//   env:      dev | test | prod
//   commands: init    create the env file from its example (test, prod); on an existing file, append the variables
//                     the example gained since. test: secrets still in the env file move into the secret files of
//                     SECRETS_DIR with the same values (ADR-0021); prod: they are named, to be deleted
//             build   quality gate (lint, test) + Docker images (the proxy image builds web/admin, ADR-0012)
//             up      start containers (detached) and wait until they are healthy; test and prod first create the
//                     missing secret files and check them (`secrets init`, `secrets check` of docker/compose.secrets.yml)
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
//             env-push                     test: the env file and the secret files, encrypted for the keepers, into the
//                                          bucket (prod: on the VPS, docs/guides/deploy-vps.md)
//             --at <UTC time>              offsite-list, -fetch, -verify: the bucket as it was then (after a break-in,
//                                          a time before it), e.g. --at 2026-10-20T21:00:00Z
//
// Checks run manually until CI/CD is chosen by an ADR (CLAUDE.md, "CI/CD").
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
// Environments with the backup service (ADR-0019) and the secret files (ADR-0021); their env files need these
// variables.
const BACKUP_ENVS = ['test', 'prod'];
const BACKUP_VARIABLES = ['BACKUP_DIR', 'SECRETS_DIR'];
// The secrets that env files of test and prod held before ADR-0021, and their files in SECRETS_DIR
// (docs/superpowers/specs/2026-10-27-secret-store-design.md, section 3). redis_users_acl is made by `secrets init`.
const SECRET_VARIABLES = {
  POSTGRES_SUPERUSER_PASSWORD: 'postgres_superuser_password',
  PHARMACY_OWNER_PASSWORD: 'pharmacy_owner_password',
  PHARMACY_APP_PASSWORD: 'pharmacy_app_password',
  PHARMACY_PLATFORM_PASSWORD: 'pharmacy_platform_password',
  PHARMACY_BACKUP_PASSWORD: 'pharmacy_backup_password',
  REDIS_PASSWORD: 'redis_password',
  SESSION_JWT_KEYS: 'session_jwt_keys',
  PASSWORD_PEPPERS: 'password_peppers',
  RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY: 'offsite_secret_access_key',
};
// A copy is named by its UTC start time; the strict pattern also keeps the argument safe for cmd.exe (shell: true).
const COPY_NAME = /^\d{8}T\d{6}Z$/;
// --at of the commands off the host, as strict for the same reason.
const AT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// Commands that build or start the stack.
const STARTING_COMMANDS = ['build', 'up', 'restore'];

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
  return fileValue(env, name) ?? fallback;
}

// A variable of the env file only, or undefined, never printed. The file is read as compose reads it: the last
// definition wins, `export ` and spaces around `=` are allowed, a quoted value loses its quotes and an unquoted one its
// ` # comment`.
function fileValue(env, name) {
  const pattern = definition(name);
  const raw = readFileSync(join(root, env.envFile), 'utf8')
    .split(/\r?\n/)
    .map((line) => pattern.exec(line)?.[1])
    .findLast((value) => value !== undefined);
  if (raw === undefined) return undefined;
  const quoted = /^(["'])(.*)\1\s*(?:#.*)?$/.exec(raw);
  return quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
}

function definition(name) {
  return new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
}

// The secrets the env file still holds with a value (ADR-0021: they belong in SECRETS_DIR). Names only.
function fileSecrets(env) {
  return Object.keys(SECRET_VARIABLES).filter((name) => fileValue(env, name));
}

// The secret directory of the env file: SECRETS_DIR is relative to docker/, as compose resolves it.
function secretsDir(env) {
  return resolve(root, 'docker', envValue(env, 'SECRETS_DIR', ''));
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
    ...(BACKUP_ENVS.includes(envName) ? ['-f', 'docker/compose.backup.yml', '-f', 'docker/compose.secrets.yml'] : []),
    '-f', `docker/compose.${envName}.yml`,
  ];
}

// test/prod: the secret files (ADR-0021). The directory is made here, 0700 — Docker would make a missing one owned by
// root — then `secrets init` creates the missing files (never overwrites one) and `secrets check` stops a broken set
// before any service starts.
function ensureSecrets(envName, env) {
  mkdirSync(secretsDir(env), { recursive: true, mode: 0o700 });
  const tool = [...composeArgs(envName, env), '--profile', 'tools', 'run', '--rm', 'secrets'];
  run('docker', [...tool, 'init']);
  run('docker', [...tool, 'check']);
}

// test/prod: the secret files, PostgreSQL, then the backup role (04-backup-role.sql creates pharmacy_backup on a new or
// an existing cluster and applies a changed password; ADR-0019), then the rest. dev rebuilds local images on the fly;
// test/prod start exactly the images made by `build`.
function up(envName, env, services) {
  const compose = composeArgs(envName, env);
  if (envName === 'dev') {
    run('docker', [...compose, 'up', '-d', '--build', '--wait', ...services]);
  } else {
    ensureSecrets(envName, env);
    run('docker', [...compose, 'up', '-d', '--no-build', '--wait', 'postgres']);
    run('docker', [
      ...compose, 'exec', '-T', 'postgres', 'pharmacy-psql', '-q', '-f', '/docker-entrypoint-initdb.d/04-backup-role.sql',
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
  const drop = [...compose, 'exec', '-T', 'postgres', 'pharmacy-psql'];
  console.log(`\n✔ ${envName}: the database is restored from copy ${name}. All sessions are reset — everyone signs in again.`);
  console.log(`  The previous database is kept as ${old} (no connections allowed). Drop it when it is no longer needed:`);
  console.log(`    docker ${drop.join(' ')} -d postgres -c "drop database ${old}"`);
  console.log('  Passwords and PINs work only with the password pepper of the copy (password_peppers, ADR-0008):');
  console.log('  the env file and the secret files are not in the copies; env-push keeps them (ADR-0021).');
}

// Copies off the host (ADR-0020, spec 2026-10-23-offsite-backups). `run --no-deps` rather than `exec`: after the loss
// of the server only postgres is up, and the backup service may not run yet.
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

// env-push (test): the env file and the secret files, one tar encrypted for the keepers, into the bucket (spec
// 2026-10-27-secret-store, K10). The tar goes to the backup service on stdin, which has the bucket key as its secret
// file; the plain text never reaches a command line or a disk. prod runs the same on the VPS, where its secrets are.
function envPush(envName, env) {
  requireOffsite(envName, env, 'env-push');
  const docker = join(root, 'docker');
  const secrets = relative(docker, secretsDir(env)).split(sep).join('/');
  if (secrets === '' || secrets.startsWith('..') || isAbsolute(secrets)) {
    fail(`env-push: SECRETS_DIR of ${env.envFile} must be a directory inside docker/, such as ./secrets/${envName}.`);
  }
  const envFile = relative(docker, join(root, env.envFile)).split(sep).join('/');
  // The env file first: pharmacy-backup checks that the archive starts with it.
  const tar = spawnSync('tar', ['-C', 'docker', '-cf', '-', envFile, secrets], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (tar.status !== 0) fail(`env-push: tar failed (exit ${tar.status}): ${String(tar.stderr).trim()}`);
  const args = [...composeArgs(envName, env), 'run', '--rm', '--no-deps', '-T', 'backup', 'pharmacy-backup', 'env-push'];
  console.log(`\n$ tar -C docker -cf - ${envFile} ${secrets} | docker ${args.join(' ')}`);
  const result = spawnSync('docker', args, {
    cwd: root,
    input: tar.stdout,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) fail(`env-push failed (exit ${result.status}); the reason is above.`);
}

function init(envName, env) {
  if (envName === 'dev') fail('dev uses the root .env — copy it from .env.example.');
  const target = join(root, env.envFile);
  const content = readFileSync(join(root, env.example), 'utf8');
  if (!existsSync(target)) {
    writeFileSync(target, content, { mode: 0o600 });
    console.log(
      `✔ Created ${env.envFile} — without secrets: \`npm run stack -- ${envName} up\` creates them in SECRETS_DIR ` +
        '(ADR-0021). Keep both out of git and chats.',
    );
    return;
  }
  // A file of an earlier init: the variables the example gained since are appended. Existing variables are never
  // changed here; names only are printed, never values.
  const current = readFileSync(target, 'utf8');
  const defined = new Set(
    [...current.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]),
  );
  const missing = content.split(/\r?\n/).filter((line) => {
    const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    return name !== undefined && !defined.has(name);
  });
  if (missing.length === 0) {
    console.log(`✔ ${env.envFile} already has every variable of ${env.example}.`);
  } else {
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    appendFileSync(target, `${separator}${missing.join('\n')}\n`);
    const names = missing.map((line) => line.slice(0, line.indexOf('=')));
    console.log(`✔ Added to ${env.envFile}: ${names.join(', ')}.`);
  }
  if (envName === 'test') {
    moveSecrets(env);
  } else if (fileSecrets(env).length > 0) {
    console.warn(
      `\n⚠ ${env.envFile} still holds ${fileSecrets(env).join(', ')}: the secrets of prod live only on the VPS, in ` +
        'files (ADR-0021, docs/guides/deploy-vps.md). Delete these lines; `build` and `up` refuse them.',
    );
  }
}

// test: the secrets an env file of the time before ADR-0021 holds move into the files of SECRETS_DIR with the same
// values — the database, the password hashes (pepper) and the sessions stay valid. A file that already exists keeps
// its value; one that differs from the env file stops the move with nothing changed. Only after every file is written
// and read back are the lines replaced, by a comment without the value. Names only are printed, never values.
function moveSecrets(env) {
  const target = join(root, env.envFile);
  const names = Object.keys(SECRET_VARIABLES).filter((name) => fileValue(env, name) !== undefined);
  if (names.length === 0) return;
  const dir = secretsDir(env);
  const setting = envValue(env, 'SECRETS_DIR', '');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const written = [];
  for (const name of names) {
    const value = fileValue(env, name);
    const file = join(dir, SECRET_VARIABLES[name]);
    // An empty variable (an S3 key never set) has nothing to move; `secrets init` makes its file.
    if (value === '') continue;
    if (existsSync(file)) {
      if (readFileSync(file, 'utf8') !== value) {
        fail(`${name} of ${env.envFile} differs from ${setting}/${SECRET_VARIABLES[name]}; nothing was moved. Keep the ` +
          'right value in one place only: the file is used from now on (ADR-0021).');
      }
    } else {
      // 0444 as the files of `secrets init`; on Windows that is the read-only attribute, which the container can
      // still replace.
      writeFileSync(file, value, { mode: 0o444, flag: 'wx' });
      written.push(SECRET_VARIABLES[name]);
    }
  }
  for (const name of names) {
    const value = fileValue(env, name);
    const file = join(dir, SECRET_VARIABLES[name]);
    if (value !== '' && readFileSync(file, 'utf8') !== value) fail(`${setting}/${SECRET_VARIABLES[name]} reads back wrong.`);
  }
  const lines = readFileSync(target, 'utf8').split(/\r?\n/).map((line) => {
    const name = names.find((candidate) => definition(candidate).test(line));
    return name === undefined ? line : `# ${name} moved to ${setting}/${SECRET_VARIABLES[name]} (ADR-0021)`;
  });
  writeFileSync(`${target}.tmp`, lines.join('\n'), { mode: 0o600 });
  renameSync(`${target}.tmp`, target);
  console.log(
    `✔ Moved ${names.join(', ')} out of ${env.envFile}` +
      (written.length > 0 ? `; written to ${setting}: ${written.join(', ')}.` : '.') +
      ` The rest of the secret files are made by \`npm run stack -- test up\`.`,
  );
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
if (envName === 'prod' && command === 'env-push') {
  fail(
    'env-push of prod runs on the VPS, where its secret files are (ADR-0021, docs/guides/deploy-vps.md):\n' +
      '    tar -C /opt/pharmacy/docker -cf - env/prod.env secrets/prod | dc run --rm --no-deps -T backup pharmacy-backup env-push',
  );
}
if (BACKUP_ENVS.includes(envName)) {
  const missing = BACKUP_VARIABLES.filter((name) => !envValue(env, name, ''));
  if (missing.length > 0) {
    fail(`${env.envFile} lacks ${missing.join(', ')} (backups ADR-0019, secrets ADR-0021). Run: npm run stack -- ${envName} init, then set BACKUP_DIR.`);
  }
}
// Secrets left in the env file (ADR-0021). prod: they belong on the VPS only, so neither a build nor a start takes a
// file that holds them. test: `up` would make new secret files beside them — a new pepper voids every password and PIN
// of the stand — so it waits for `init`, which moves the values.
if (
  BACKUP_ENVS.includes(envName) &&
  (['up', 'restore'].includes(command) || (envName === 'prod' && command === 'build')) &&
  fileSecrets(env).length > 0
) {
  const names = fileSecrets(env).join(', ');
  if (envName === 'prod') {
    fail(`${env.envFile} holds ${names}: the secrets of prod live only on the VPS, in files (ADR-0021, docs/guides/deploy-vps.md). Delete these lines.`);
  }
  fail(`${env.envFile} still holds ${names}. Run \`npm run stack -- ${envName} init\`: it moves them into SECRETS_DIR with the same values (ADR-0021).`);
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
