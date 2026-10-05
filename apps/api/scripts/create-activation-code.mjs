// Issues a one-time activation code for an employee (auth design 2026-10-02, section 6): the first
// code of an owner at installation, or a reset. Usage:
//   node apps/api/scripts/create-activation-code.mjs --login <login|phone|e-mail>
//
// Reads DATABASE_URL (the pharmacy_app role) and, optionally, ACTIVATION_CODE_TTL_HOURS (default
// 72) from the environment. Prints only the code and its expiry, once, to stdout; the hash and the
// connection string are never printed. Errors go to stderr with exit code 1.
//
// Plain Node ESM that cannot import the TypeScript sources of the API, so two small pieces are
// duplicated and must stay in step with them: the identifier rules (apps/api/src/app/auth/
// identifier.ts) and the code format (apps/api/src/app/auth/activation-code.ts). The integration
// test activation-script.int-spec.ts checks both against the real implementation.
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const DEFAULT_TTL_HOURS = 72;

// --- Identifier normalization (identifier.ts) ---------------------------------------------------

const MAX_LOGIN_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
const COUNTRY_CODE = '992';
const NATIONAL_DIGITS = 9;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPED = /^[+\d\s\-()]+$/;
const PHONE_SEPARATORS = /[\s\-()]/g;
const DIGITS = /^\d+$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const WHITESPACE = /\s/;

function normalizePhone(raw) {
  const compact = raw.replace(PHONE_SEPARATORS, '');
  let candidate = null;
  if (compact.startsWith('+')) {
    candidate = compact;
  } else if (DIGITS.test(compact)) {
    if (compact.length === NATIONAL_DIGITS) {
      candidate = `+${COUNTRY_CODE}${compact}`;
    } else if (
      compact.length === COUNTRY_CODE.length + NATIONAL_DIGITS &&
      compact.startsWith(COUNTRY_CODE)
    ) {
      candidate = `+${compact}`;
    }
  }
  return candidate !== null && E164.test(candidate) ? candidate : null;
}

function normalizeIdentifier(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email)
      ? { kind: 'email', value: email }
      : null;
  }
  if (PHONE_SHAPED.test(trimmed)) {
    const phone = normalizePhone(trimmed);
    return phone === null ? null : { kind: 'phone', value: phone };
  }
  const login = trimmed.toLowerCase();
  return login.length <= MAX_LOGIN_LENGTH && !WHITESPACE.test(login)
    ? { kind: 'login', value: login }
    : null;
}

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

function parseArgs(argv) {
  const index = argv.indexOf('--login');
  const login = index === -1 ? undefined : argv[index + 1];
  if (!login || login.startsWith('--')) {
    throw new UserError(
      'Usage: node apps/api/scripts/create-activation-code.mjs --login <login|phone|e-mail>',
    );
  }
  return { login };
}

function ttlHours(env) {
  const raw = env.ACTIVATION_CODE_TTL_HOURS;
  if (raw === undefined || raw === '') return DEFAULT_TTL_HOURS;
  const hours = Number(raw);
  if (!Number.isInteger(hours) || hours < 1) {
    throw new UserError(
      'ACTIVATION_CODE_TTL_HOURS must be a positive integer.',
    );
  }
  return hours;
}

async function main() {
  const { login } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new UserError('DATABASE_URL is not set.');
  const hours = ttlHours(process.env);

  const identifier = normalizeIdentifier(login);
  if (identifier === null) {
    throw new UserError('The login is not a valid login, phone or e-mail.');
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: 'create-activation-code',
  });
  await client.connect();
  try {
    const resolved = await client.query(
      'select tenant_id, employee_id, tenant_status from pharmacy.resolve_login($1, $2)',
      [identifier.kind, identifier.value],
    );
    // Identifiers are globally unique: exactly one row, otherwise nothing is issued.
    if (resolved.rows.length !== 1) {
      throw new UserError('No employee found for this login.');
    }
    const {
      tenant_id: tenantId,
      employee_id: employeeId,
      tenant_status: tenantStatus,
    } = resolved.rows[0];
    if (tenantStatus !== 'active') {
      throw new UserError('The network of this employee is not active.');
    }

    const { code, display } = generateActivationCode();
    const hash = createHash('sha256').update(code, 'utf8').digest('hex');

    await client.query('begin');
    try {
      await client.query("select set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      const employee = await client.query(
        'select status from pharmacy.employees where tenant_id = $1 and id = $2',
        [tenantId, employeeId],
      );
      if (employee.rows.length !== 1 || employee.rows[0].status !== 'active') {
        throw new UserError('The employee is not active.');
      }
      // A new code replaces an earlier unused one; the password stays until the code is used.
      const stored = await client.query(
        `insert into pharmacy.employee_credentials
           (tenant_id, employee_id, one_time_code_hash, one_time_code_expires_at)
         values ($1, $2, $3, now() + make_interval(hours => $4::int))
         on conflict (tenant_id, employee_id) do update set
           one_time_code_hash = excluded.one_time_code_hash,
           one_time_code_expires_at = excluded.one_time_code_expires_at,
           updated_at = now()
         returning one_time_code_expires_at`,
        [tenantId, employeeId, hash, hours],
      );
      await client.query('commit');
      const expiresAt = stored.rows[0].one_time_code_expires_at.toISOString();
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
      `Could not issue the code (${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}).`,
    );
  }
  process.exit(1);
});
