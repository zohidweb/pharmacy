// Creates a platform operator, or finds an existing one, and issues a one-time activation code
// (auth design 2026-10-02, section 9; plan auth-part3 decision P1). The operator then sets a
// password with POST /api/v1/operator/activations. Usage:
//   node apps/api/scripts/create-operator.mjs --login <work e-mail> --name "<full name>"
//
// Reads PLATFORM_DATABASE_URL (the pharmacy_platform role) and, optionally,
// ACTIVATION_CODE_TTL_HOURS (default 72). Prints only the code and its expiry, once, to stdout;
// the hash and the connection string are never printed. Errors go to stderr with exit code 1.
//
// Plain Node ESM that cannot import the TypeScript sources of the API, so the e-mail rule
// (apps/api/src/app/auth/identifier.ts) and the code format (apps/api/src/app/auth/
// activation-code.ts) are duplicated here and must stay in step with them, as in
// create-activation-code.mjs.
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

const DEFAULT_TTL_HOURS = 72;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTOR = 'system:create-operator';

// --- Activation code (activation-code.ts) -------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function generateActivationCode() {
  const code = base32(randomBytes(16));
  const groups = code.match(/.{1,4}/g) ?? [];
  return { code, display: groups.join('-') };
}

// --- Command ------------------------------------------------------------------------------------

class UserError extends Error {}

const USAGE =
  'Usage: node apps/api/scripts/create-operator.mjs --login <work e-mail> --name "<full name>"';

function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

function parseArgs(argv) {
  if (argv.includes('--help')) throw new UserError(USAGE);
  const rawLogin = option(argv, '--login');
  const rawName = option(argv, '--name');
  if (!rawLogin || !rawName) throw new UserError(USAGE);
  const login = rawLogin.trim().toLowerCase();
  if (login.length > MAX_EMAIL_LENGTH || !EMAIL.test(login)) {
    throw new UserError('The login must be a work e-mail.');
  }
  const name = rawName.trim();
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    throw new UserError(`The name must be 1-${MAX_NAME_LENGTH} characters.`);
  }
  return { login, name };
}

function ttlHours(env) {
  const raw = env.ACTIVATION_CODE_TTL_HOURS;
  if (raw === undefined || raw === '') return DEFAULT_TTL_HOURS;
  const hours = Number(raw);
  if (!Number.isInteger(hours) || hours < 1) {
    throw new UserError('ACTIVATION_CODE_TTL_HOURS must be a positive integer.');
  }
  return hours;
}

async function main() {
  const { login, name } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.PLATFORM_DATABASE_URL;
  if (!databaseUrl) throw new UserError('PLATFORM_DATABASE_URL is not set.');
  const hours = ttlHours(process.env);

  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: 'create-operator',
  });
  await client.connect();
  try {
    const { code, display } = generateActivationCode();
    const hash = createHash('sha256').update(code, 'utf8').digest('hex');

    await client.query('begin');
    try {
      await client.query("select set_config('app.actor', $1, true)", [ACTOR]);

      // An existing operator keeps his name and status; a blocked one gets no code.
      const found = await client.query(
        'select id, status from pharmacy.operators where lower(login) = $1',
        [login],
      );
      let operatorId;
      let created = false;
      if (found.rows.length === 1) {
        if (found.rows[0].status !== 'active') {
          throw new UserError('The operator is blocked.');
        }
        operatorId = found.rows[0].id;
      } else {
        operatorId = uuidv7();
        created = true;
        await client.query(
          'insert into pharmacy.operators (id, login, full_name) values ($1, $2, $3)',
          [operatorId, login, name],
        );
      }

      // A new code replaces an earlier unused one; a password stays until the code is used.
      const stored = await client.query(
        `insert into pharmacy.operator_credentials
           (operator_id, one_time_code_hash, one_time_code_expires_at)
         values ($1, $2, now() + make_interval(hours => $3::int))
         on conflict (operator_id) do update set
           one_time_code_hash = excluded.one_time_code_hash,
           one_time_code_expires_at = excluded.one_time_code_expires_at,
           updated_at = now()
         returning one_time_code_expires_at`,
        [operatorId, hash, hours],
      );

      await client.query(
        `insert into pharmacy.platform_audit_log
           (id, actor_kind, job, action, entity_type, entity_id, details, correlation_id)
         values ($1, 'system', 'create-operator', 'operator.code-issued', 'operator', $2, $3, $4)`,
        [uuidv7(), operatorId, JSON.stringify({ created }), uuidv7()],
      );
      await client.query('commit');

      const expiresAt = stored.rows[0].one_time_code_expires_at.toISOString();
      console.log(created ? 'Operator created.' : 'Operator exists; a new code is issued.');
      console.log(`Activation code: ${display}`);
      console.log(`Valid until: ${expiresAt}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // Only a fixed message or the error class and code: a database message may carry values.
  if (error instanceof UserError) {
    console.error(error.message);
  } else {
    console.error(
      `Could not create the operator (${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}).`,
    );
  }
  process.exit(1);
});
