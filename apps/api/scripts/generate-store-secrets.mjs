// Writes the session and password keys of an offline store into its env file (auth design
// 2026-10-02, section 10): a 256-bit JWT key and a 256-bit pepper, generated on the store's PC and
// never sent to the cloud. Usage:
//   node apps/api/scripts/generate-store-secrets.mjs --env-file <path>
//
// Appends SESSION_JWT_KEYS, SESSION_JWT_ACTIVE_KID, PASSWORD_PEPPERS and PASSWORD_PEPPER_ACTIVE.
// The values are never printed. A file that already defines any of them is left untouched (exit 1):
// replacing a pepper makes every stored password unverifiable, and a key rotation needs the old key
// kept in the list. Back up the pepper separately from the database backup.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const NAMES = [
  'SESSION_JWT_KEYS',
  'SESSION_JWT_ACTIVE_KID',
  'PASSWORD_PEPPERS',
  'PASSWORD_PEPPER_ACTIVE',
];

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
  return NAMES.filter((name) => new RegExp(`^\\s*${name}\\s*=`, 'm').test(content));
}

function main() {
  const { file } = parseArgs(process.argv.slice(2));
  const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const present = definedNames(content);
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
  appendFileSync(file, `${separator}${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`Wrote ${NAMES.join(', ')} to the env file.`);
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
