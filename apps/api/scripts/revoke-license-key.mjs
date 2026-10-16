// Revokes the license key of an offline store (ADR-0014 §7; spec 2026-10-16-offline-sync, E11, E12), until the
// operator screen «Лицензии» exists. Usage:
//   node apps/api/scripts/revoke-license-key.mjs --store <store uuid> [--hard]
//
// Reads PLATFORM_DATABASE_URL (the pharmacy_platform role). Without --hard the active key becomes `revoked`: the
// cloud still accepts the operations of the store for the grace days of the platform, the feed stops. --hard
// (a compromised key) makes the latest key `revoked_hard`: nothing is accepted any more. Prints what changed.
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

const ACTOR = 'system:revoke-license-key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE = 'Usage: node apps/api/scripts/revoke-license-key.mjs --store <store uuid> [--hard]';

class UserError extends Error {}

function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  const store = option(argv, '--store')?.toLowerCase();
  if (!store || !UUID.test(store)) throw new UserError(USAGE);
  const hard = argv.includes('--hard');
  const databaseUrl = process.env.PLATFORM_DATABASE_URL;
  if (!databaseUrl) throw new UserError('PLATFORM_DATABASE_URL is not set.');

  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: 'revoke-license-key',
  });
  await client.connect();
  try {
    await client.query('begin');
    try {
      await client.query("select set_config('app.actor', $1, true)", [ACTOR]);
      // The active key, or with --hard the latest key that is not yet hard-revoked.
      const target = await client.query(
        `select id, tenant_id, key_id, status from pharmacy.license_keys
         where store_id = $1 and status ${hard ? "<> 'revoked_hard'" : "= 'active'"}
         order by issued_at desc limit 1`,
        [store],
      );
      if (target.rows.length !== 1) throw new UserError('The store has no key to revoke.');
      const key = target.rows[0];
      const status = hard ? 'revoked_hard' : 'revoked';
      await client.query(
        `update pharmacy.license_keys
         set status = $2, revoked_at = coalesce(revoked_at, now())
         where id = $1`,
        [key.id, status],
      );
      await client.query(
        `insert into pharmacy.platform_audit_log
           (id, actor_kind, job, action, tenant_id, entity_type, entity_id, details, correlation_id)
         values ($1, 'system', 'revoke-license-key', 'license.revoked', $2, 'store', $3, $4, $5)`,
        [uuidv7(), key.tenant_id, store, JSON.stringify({ keyId: key.key_id, status }), uuidv7()],
      );
      await client.query('commit');
      console.log(`Key ${key.key_id}: ${key.status} -> ${status}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  if (error instanceof UserError) {
    console.error(error.message);
  } else {
    console.error(
      `Could not revoke the key (${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}).`,
    );
  }
  process.exit(1);
});
