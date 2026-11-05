#!/usr/bin/env node
// The lifecycle of the database of the load run (docs/guides/load-test.md):
//
//   node tools/load/db.mjs create            empty pharmacy_load, 02-database.sql, all migrations
//   node tools/load/db.mjs migrate           pending migrations only
//   node tools/load/db.mjs size              the database and its ten largest tables
//   node tools/load/db.mjs drop              the database and tools/load/.state (the owner, terminals of that base)
//
// Only pharmacy_load of the dev container: env.mjs refuses any other database.
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOAD_DB, ROOT, STATE_DIR, loadEnv, psql } from './env.mjs';

const MIGRATIONS = join(ROOT, 'apps', 'api', 'migrations');

async function exists() {
  const out = await psql(
    { sql: `select count(*) from pg_database where datname = '${LOAD_DB}';` },
    {},
    { database: 'postgres', args: ['-At'] },
  );
  return out.trim() === '1';
}

function migrate() {
  const result = spawnSync(process.execPath, [join(ROOT, 'apps', 'api', 'scripts', 'migrate.mjs')], {
    env: loadEnv(),
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`migrations failed (exit ${result.status})`);
}

async function create() {
  if (await exists()) throw new Error(`${LOAD_DB} already exists: drop it first (node tools/load/db.mjs drop)`);
  await psql({ sql: `create database ${LOAD_DB} owner pharmacy_owner;` }, {}, { database: 'postgres' });
  // the same script that prepares the dev database and pharmacy_test; it starts with SET ROLE pharmacy_owner
  await psql({ file: join(ROOT, 'docker', 'postgres', 'initdb', '02-database.sql') });
  migrate();
  const applied = Number((await psql({ sql: 'select count(*) from public.pgmigrations;' }, {}, { args: ['-At'] })).trim());
  const files = readdirSync(MIGRATIONS).filter((file) => !file.startsWith('.')).length;
  if (applied !== files) throw new Error(`${applied} migrations applied, ${files} files in apps/api/migrations`);
  console.log(`${LOAD_DB} created, ${applied} migrations applied`);
}

async function drop() {
  await psql({ sql: `drop database if exists ${LOAD_DB} with (force);` }, {}, { database: 'postgres' });
  // the owner's password and the device cookies belong to the dropped database
  rmSync(STATE_DIR, { recursive: true, force: true });
  console.log(`${LOAD_DB} dropped; the disk of Docker does not shrink by itself (docs/guides/load-test.md)`);
}

export async function size() {
  return psql(
    {
      sql: `
select 'database' as relation, pg_size_pretty(pg_database_size(current_database())) as size;
select coalesce(parent.relname, c.relname) as relation, pg_size_pretty(sum(pg_total_relation_size(c.oid))) as size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_inherits i on i.inhrelid = c.oid
left join pg_class parent on parent.oid = i.inhparent
where n.nspname = 'pharmacy' and c.relkind = 'r'
group by 1
order by sum(pg_total_relation_size(c.oid)) desc
limit 10;`,
    },
    {},
    { args: ['-A', '-F', '\t', '-P', 'footer=off'] },
  );
}

const commands = {
  create,
  drop,
  migrate: async () => migrate(),
  size: async () => process.stdout.write(await size()),
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  const run = commands[command];
  if (!run) {
    console.error(`usage: node tools/load/db.mjs ${Object.keys(commands).join(' | ')}`);
    process.exit(2);
  }
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
