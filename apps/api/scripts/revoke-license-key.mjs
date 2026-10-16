// Revokes the license key of an offline store (ADR-0014 §7; spec 2026-10-16-offline-sync, E11, E12), until the
// operator screen «Лицензии» exists. Usage:
//   node apps/api/scripts/revoke-license-key.mjs --store <store uuid>
//   node apps/api/scripts/revoke-license-key.mjs --store <store uuid> --hard --key <key id>
//
// Reads PLATFORM_DATABASE_URL (the pharmacy_platform role). Without --hard the active key becomes `revoked`: the
// cloud still accepts the operations of the store for the grace days of the platform, the feed stops. --hard (a
// compromised key, a lost or stolen PC) makes the named key `revoked_hard`: nothing is accepted any more. The key
// is named on purpose: after a lost PC a new key is issued first, and the stolen one is the older, revoked key —
// never the newest. Without --key, --hard lists the keys of the store and changes nothing. Prints what changed.
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

const ACTOR = 'system:revoke-license-key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE =
  'Usage: node apps/api/scripts/revoke-license-key.mjs --store <store uuid> [--hard --key <key id>]';
const KEY_ID = /^[0-9a-f]{16}$/;

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
  const keyId = option(argv, '--key')?.toLowerCase();
  if (keyId !== undefined && !KEY_ID.test(keyId))
    throw new UserError('--key must be a key id (16 hex).');
  if (!hard && keyId !== undefined)
    throw new UserError('--key goes with --hard.');
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
      if (hard && keyId === undefined) {
        const keys = await client.query(
          `select key_id, status, issued_at from pharmacy.license_keys where store_id = $1 order by issued_at`,
          [store],
        );
        const list = keys.rows
          .map(
            (k) =>
              `  ${k.key_id} ${k.status} issued ${k.issued_at.toISOString()}`,
          )
          .join('\n');
        throw new UserError(
          `--hard needs --key <key id>. Keys of the store:\n${list || '  none'}`,
        );
      }
      // The active key, or with --hard the named key that is not yet hard-revoked.
      const target = hard
        ? await client.query(
            `select id, tenant_id, key_id, status from pharmacy.license_keys
             where store_id = $1 and key_id = $2 and status <> 'revoked_hard'`,
            [store, keyId],
          )
        : await client.query(
            `select id, tenant_id, key_id, status from pharmacy.license_keys
             where store_id = $1 and status = 'active'`,
            [store],
          );
      if (target.rows.length !== 1)
        throw new UserError('The store has no such key to revoke.');
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
        [
          uuidv7(),
          key.tenant_id,
          store,
          JSON.stringify({ keyId: key.key_id, status }),
          uuidv7(),
        ],
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
