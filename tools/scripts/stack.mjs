#!/usr/bin/env node
// Build and run the Pharmacy stack per environment (CLAUDE.md, "Environments").
//
//   npm run stack -- <env> <command> [service...] [--skip-checks]
//
//   env:      dev | test | prod
//   commands: init    create the env file from its example with random passwords (test, prod)
//             build   quality gate (lint, test, build) + static web/admin + Docker images
//             up      start containers (detached) and wait until they are healthy
//             down    stop containers (data volumes are kept)
//             ps      container status
//             logs    follow logs (optionally of given services)
//
// Checks run manually until CI/CD is chosen by an ADR (CLAUDE.md, "CI/CD").
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ENVS = {
  dev: { envFile: '.env', example: '.env.example', project: 'pharmacy-dev' },
  test: { envFile: 'docker/env/test.env', example: 'docker/env/test.env.example', project: 'pharmacy-test' },
  prod: { envFile: 'docker/env/prod.env', example: 'docker/env/prod.env.example', project: 'pharmacy-prod' },
};
const COMMANDS = ['init', 'build', 'up', 'down', 'ps', 'logs'];

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
    '-f', `docker/compose.${envName}.yml`,
  ];
}

function init(envName, env) {
  if (envName === 'dev') fail('dev uses the root .env — copy it from .env.example.');
  if (existsSync(join(root, env.envFile))) fail(`${env.envFile} already exists — not overwriting it.`);
  const content = readFileSync(join(root, env.example), 'utf8').replace(
    /change-me/g,
    () => randomBytes(18).toString('base64url'),
  );
  writeFileSync(join(root, env.envFile), content, { mode: 0o600 });
  console.log(`✔ Created ${env.envFile} with random passwords. Keep it out of git and chats.`);
}

function build(envName, env, skipChecks) {
  const nx = ['nx'];
  if (!skipChecks) {
    run('npx', [...nx, 'run-many', '-t', 'lint', 'test', '--outputStyle=static']);
  } else {
    console.log('\n⚠ Quality gate skipped (--skip-checks).');
  }
  // Static export of the frontends: apps/web/out, apps/admin/out (served after the reverse-proxy ADR, future ADR-0012).
  run('npx', [...nx, 'run-many', '-t', 'build', '-p', 'web', 'admin', '--outputStyle=static'], {
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
  });
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

process.env.IMAGE_TAG = imageTag(envName);

switch (command) {
  case 'build':
    build(envName, env, skipChecks);
    break;
  case 'up':
    // dev rebuilds local images on the fly; test/prod start exactly the images made by `build`.
    run('docker', [...composeArgs(envName, env), 'up', '-d', envName === 'dev' ? '--build' : '--no-build', '--wait', ...services]);
    run('docker', [...composeArgs(envName, env), 'ps']);
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
