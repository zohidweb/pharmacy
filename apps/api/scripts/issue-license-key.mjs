// Issues the license key of an offline store (ADR-0014 §6; spec 2026-10-16-offline-sync, E10, E11), until the
// operator screen «Лицензии» exists. Usage:
//   node apps/api/scripts/issue-license-key.mjs --store <store uuid> --valid-until <YYYY-MM-DD>
//     [--notify-days <0-365>]
//
// Reads PLATFORM_DATABASE_URL (the pharmacy_platform role). The active key of the store, if any, is revoked
// and replaced. Prints the key phk_<keyId>_<secret> and its expiry once, to stdout; only the SHA-256 of the
// secret is stored, and the key never reaches the database, the log or the audit. Errors go to stderr with
// exit code 1. The key goes to the env file of the store (SYNC_LICENSE_KEY), never into git.
//
// Plain Node ESM that cannot import the TypeScript sources of the API: the key format is duplicated from
// apps/api/src/common/http/contour.ts (licenseKeyIdOf) and must stay in step with it.
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

const ACTOR = 'system:issue-license-key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const USAGE =
  'Usage: node apps/api/scripts/issue-license-key.mjs --store <store uuid> --valid-until <YYYY-MM-DD> ' +
  '[--notify-days <0-365>]';

class UserError extends Error {}

function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

function parseArgs(argv) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  const store = option(argv, '--store')?.toLowerCase();
  const until = option(argv, '--valid-until');
  const notify = option(argv, '--notify-days') ?? '7';
  if (!store || !until) throw new UserError(USAGE);
  if (!UUID.test(store)) throw new UserError('--store must be a store uuid.');
  // The end of the given day in the time zone of the platform (Asia/Dushanbe, UTC+5).
  const validUntil = new Date(`${until}T23:59:59+05:00`);
  if (!DATE.test(until) || Number.isNaN(validUntil.getTime())) {
    throw new UserError('--valid-until must be a date YYYY-MM-DD.');
  }
  if (validUntil <= new Date()) throw new UserError('--valid-until must be in the future.');
  const notifyDays = Number(notify);
  if (!Number.isInteger(notifyDays) || notifyDays < 0 || notifyDays > 365) {
    throw new UserError('--notify-days must be an integer 0-365.');
  }
  return { store, validUntil, notifyDays };
}

async function main() {
  const { store, validUntil, notifyDays } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.PLATFORM_DATABASE_URL;
  if (!databaseUrl) throw new UserError('PLATFORM_DATABASE_URL is not set.');

  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: 'issue-license-key',
  });
  await client.connect();
  try {
    // keyId: 16 hex characters; the secret: 32 random bytes in base64url (43 characters).
    const keyId = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const keyHash = createHash('sha256').update(secret, 'utf8').digest();

    await client.query('begin');
    try {
      await client.query("select set_config('app.actor', $1, true)", [ACTOR]);
      const found = await client.query(
        'select tenant_id, status from pharmacy.stores where id = $1',
        [store],
      );
      if (found.rows.length !== 1) throw new UserError('The store is not found.');
      const { tenant_id: tenantId, status } = found.rows[0];
      if (status === 'closed') throw new UserError('The store is closed.');

      // The active key of the store is replaced: it stops working at once (revoked, with the grace of E12).
      const previous = await client.query(
        `update pharmacy.license_keys set status = 'revoked', revoked_at = now()
         where tenant_id = $1 and store_id = $2 and status = 'active'
         returning id`,
        [tenantId, store],
      );
      const replaces = previous.rows[0]?.id ?? null;
      const id = uuidv7();
      await client.query(
        `insert into pharmacy.license_keys
           (id, key_id, key_hash, tenant_id, store_id, valid_until, notify_before_days, replaces_key_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, keyId, keyHash, tenantId, store, validUntil, notifyDays, replaces],
      );
      await client.query(
        `insert into pharmacy.platform_audit_log
           (id, actor_kind, job, action, tenant_id, entity_type, entity_id, details, correlation_id)
         values ($1, 'system', 'issue-license-key', 'license.issued', $2, 'store', $3, $4, $5)`,
        [
          uuidv7(),
          tenantId,
          store,
          JSON.stringify({ keyId, validUntil: validUntil.toISOString(), replaced: replaces !== null }),
          uuidv7(),
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    console.log(`License key: phk_${keyId}_${secret}`);
    console.log(`Valid until: ${validUntil.toISOString()}`);
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
      `Could not issue the key (${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}).`,
    );
  }
  process.exit(1);
});
