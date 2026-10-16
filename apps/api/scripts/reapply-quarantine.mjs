// Puts the quarantined operations of an offline store back in line (ADR-0014 §4; spec 2026-10-16-offline-sync,
// E15), until the operator screen of the sync exists. Usage:
//   node apps/api/scripts/reapply-quarantine.mjs --store <store uuid>
//
// Reads PLATFORM_DATABASE_URL (finds the network of the store in the store registry) and DATABASE_URL (the
// pharmacy_app role, in the context of that network). The quarantined rows of the store become
// `pending_dependency` with the reason `requeued:<previous code>`; the cloud re-applies them at the end of the
// next batch of that store, after the code is fixed. Prints the number of rows; payloads are never printed.
import pg from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE = 'Usage: node apps/api/scripts/reapply-quarantine.mjs --store <store uuid>';

class UserError extends Error {}

function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

async function tenantOf(store) {
  const url = process.env.PLATFORM_DATABASE_URL;
  if (!url) throw new UserError('PLATFORM_DATABASE_URL is not set.');
  const client = new pg.Client({ connectionString: url, application_name: 'reapply-quarantine' });
  await client.connect();
  try {
    const found = await client.query('select tenant_id from pharmacy.stores where id = $1', [store]);
    if (found.rows.length !== 1) throw new UserError('The store is not found.');
    return found.rows[0].tenant_id;
  } finally {
    await client.end();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  const store = option(argv, '--store')?.toLowerCase();
  if (!store || !UUID.test(store)) throw new UserError(USAGE);
  const tenantId = await tenantOf(store);

  const url = process.env.DATABASE_URL;
  if (!url) throw new UserError('DATABASE_URL is not set.');
  const client = new pg.Client({ connectionString: url, application_name: 'reapply-quarantine' });
  await client.connect();
  try {
    await client.query('begin');
    try {
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const updated = await client.query(
        `update pharmacy.sync_inbox
         set status = 'pending_dependency', reason = left('requeued:' || coalesce(reason, ''), 200)
         where tenant_id = $1 and store_id = $2 and status = 'quarantined'`,
        [tenantId, store],
      );
      await client.query('commit');
      console.log(`Operations put back in line: ${updated.rowCount}`);
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
      `Could not requeue the operations (${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}).`,
    );
  }
  process.exit(1);
});
