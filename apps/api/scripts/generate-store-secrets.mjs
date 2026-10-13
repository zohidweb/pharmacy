// Writes the session and password keys of an offline store into its env file (auth design
// 2026-10-02, section 10): a 256-bit JWT key and a 256-bit pepper, generated on the store's PC and
// never sent to the cloud. Usage:
//   node apps/api/scripts/generate-store-secrets.mjs --env-file <path>
//
// Appends SESSION_JWT_KEYS, SESSION_JWT_ACTIVE_KID, PASSWORD_PEPPERS and PASSWORD_PEPPER_ACTIVE.
// The values are never printed. A file that already defines any of them is left untouched (exit 1):
// replacing a pepper makes every stored password unverifiable, and a key rotation needs the old key
// kept in the list. Back up the pepper separately from the database backup.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';

const NAMES = [
  'SESSION_JWT_KEYS',
  'SESSION_JWT_ACTIVE_KID',
  'PASSWORD_PEPPERS',
  'PASSWORD_PEPPER_ACTIVE',
];

// SHA-256 of the key material of the public development keys in .env.example (the same list as
// apps/api/src/core/crypto/key-ring.ts): an env file copied from it must not keep them.
const PUBLIC_DEVELOPMENT_KEYS = new Set([
  'f4a93ffde842c2c2be34f26a6064e95c5770a69e11d3f540ab155be35af6680b',
  '163f791e6e5d7ece06a1d3f0e584c0ddb67bd0ca587569d23a4d03c3596cdcdb',
]);

class UserError extends Error {}

const USAGE = 'Usage: node apps/api/scripts/generate-store-secrets.mjs --env-file <path>';

function parseArgs(argv) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  const index = argv.indexOf('--env-file');
  const file = index === -1 ? undefined : argv[index + 1];
  if (!file || file.startsWith('--')) throw new UserError(USAGE);
  return { file };
}

function definedNames(content) {
  // `NAME=`, the shell form `export NAME=` and the dotenv form `NAME: value` all define a value; a
  // commented line does not.
  return NAMES.filter((name) =>
    new RegExp(`^\\s*(?:export\\s+)?${name}\\s*[=:]`, 'm').test(content),
  );
}

// Whether a key list of the file (`id:base64url,…` after `NAME=` or `NAME:`) holds a public
// development key.
function holdsPublicDevelopmentKey(content) {
  return ['SESSION_JWT_KEYS', 'PASSWORD_PEPPERS'].some((name) => {
    const match = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*[=:]\\s*(.*)$`, 'm').exec(content);
    if (!match) return false;
    return match[1]
      .trim()
      .replace(/^["']|["']$/g, '')
      .split(',')
      .some((entry) => {
        const encoded = entry.trim().split(':')[1] ?? '';
        const digest = createHash('sha256')
          .update(Buffer.from(encoded, 'base64url'))
          .digest('hex');
        return PUBLIC_DEVELOPMENT_KEYS.has(digest);
      });
  });
}

function main() {
  const { file } = parseArgs(process.argv.slice(2));
  const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const present = definedNames(content);
  if (present.length > 0 && holdsPublicDevelopmentKey(content)) {
    // Copied from .env.example: the store would run on public keys (the API refuses them in
    // production). Not replaced here: if the store already ran, its passwords depend on the pepper.
    throw new UserError(
      `The file holds the public development keys of .env.example. On a store that has not run yet, delete the lines ${NAMES.join(', ')} and run this again; nothing was written.`,
    );
  }
  if (present.length > 0) {
    throw new UserError(
      `The file already defines ${present.join(', ')}; nothing was written.`,
    );
  }
  const key = () => randomBytes(32).toString('base64url');
  const lines = [
    `SESSION_JWT_KEYS=k1:${key()}`,
    'SESSION_JWT_ACTIVE_KID=k1',
    `PASSWORD_PEPPERS=1:${key()}`,
    'PASSWORD_PEPPER_ACTIVE=1',
  ];
  const separator = content === '' || content.endsWith('\n') ? '' : '\n';
  // The mode of appendFileSync applies to a new file only: an existing one is narrowed first, so a
  // refusal (a file of another owner) stops the script before any key is written.
  const posix = process.platform !== 'win32';
  if (posix && existsSync(file)) chmodSync(file, 0o600);
  appendFileSync(file, `${separator}${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(
    posix
      ? `Wrote ${NAMES.join(', ')} to the env file (mode 600).`
      : `Wrote ${NAMES.join(', ')} to the env file. Allow only the account of the service to read it.`,
  );
}

try {
  main();
} catch (error) {
  if (error instanceof UserError) {
    console.error(error.message);
  } else {
    console.error(`Could not write the secrets (${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}).`);
  }
  process.exit(1);
}
