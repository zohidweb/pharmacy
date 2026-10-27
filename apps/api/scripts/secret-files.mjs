// Secrets from files (ADR-0021, spec 2026-10-27-secret-store-design, K4). In test and prod compose mounts each secret
// at /run/secrets/<name> and loads this module before any code of the image (NODE_OPTIONS=--import=…): main.js,
// migrate.mjs and the scripts of the operator. dev has no loader: the variables come from .env.
//
// For every <V>_FILE of SECRETS below that the environment sets (a list, so that a variable such as LOG_FILE is never
// taken for a secret; a new secret is added here and in docker/compose.secrets.yml):
//   - <V> ends with _PASSWORD and <P>_URL is set (P = V without _PASSWORD): the password goes into that URL, which
//     compose writes without one (postgres://pharmacy_app@postgres:5432/pharmacy);
//   - otherwise the file sets <V>.
// A trailing line break of the file is dropped. <V> and <V>_FILE together, a URL that already holds a password or a
// file that cannot be read stop the process; the message names the variable and the path, never the value.
// An applied <V>_FILE is removed, so a child process (NODE_OPTIONS is inherited) finds nothing to apply twice.
import { readFileSync } from 'node:fs';

function fail(message) {
  process.stderr.write(`secret-files: ${message}\n`);
  process.exit(1);
}

const SECRETS = [
  'DATABASE_PASSWORD',
  'PLATFORM_DATABASE_PASSWORD',
  'MIGRATION_DATABASE_PASSWORD',
  'REDIS_PASSWORD',
  'SESSION_JWT_KEYS',
  'PASSWORD_PEPPERS',
];

for (const name of SECRETS) {
  const fileVariable = `${name}_FILE`;
  const path = process.env[fileVariable];
  if (path === undefined) continue;
  if (process.env[name] !== undefined) fail(`both ${name} and ${fileVariable} are set`);
  let value;
  try {
    value = readFileSync(path, 'utf8').replace(/(?:\r?\n)+$/, '');
  } catch (error) {
    fail(`cannot read ${fileVariable} (${path}): ${error?.code ?? 'error'}`);
  }
  const urlVariable = name.endsWith('_PASSWORD') ? `${name.slice(0, -'_PASSWORD'.length)}_URL` : undefined;
  if (urlVariable !== undefined && process.env[urlVariable] !== undefined) {
    let url;
    try {
      url = new URL(process.env[urlVariable]);
    } catch {
      fail(`${urlVariable} is not a URL`);
    }
    if (url.password !== '') fail(`${urlVariable} already holds a password; ${fileVariable} sets it`);
    // Encoded in full: the URL setter leaves % as it is, and the clients decode the password (decodeURIComponent).
    url.password = encodeURIComponent(value);
    process.env[urlVariable] = url.href;
  } else {
    process.env[name] = value;
  }
  delete process.env[fileVariable];
}
