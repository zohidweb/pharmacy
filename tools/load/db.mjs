#!/usr/bin/env node
// The lifecycle of the database of the load run (docs/guides/load-test.md):
//
//   node tools/load/db.mjs create                empty pharmacy_load, 02-database.sql, all migrations
//   node tools/load/db.mjs migrate               pending migrations only
//   node tools/load/db.mjs generate [--scale 1]  a year of the network «Нагрузка» (generate.sql), resumes by month
//   node tools/load/db.mjs verify                counts, invariants and dangling references of the generated data
//   node tools/load/db.mjs size                  the database and its ten largest tables
//   node tools/load/db.mjs drop                  the database and tools/load/.state (the owner, terminals of that base)
//
// Only pharmacy_load of the dev container: env.mjs refuses any other database.
import { spawnSync } from 'node:child_process';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOAD_DB, ROOT, STATE_DIR, loadEnv, psql } from './env.mjs';

const MIGRATIONS = join(ROOT, 'apps', 'api', 'migrations');
const GENERATOR = join(ROOT, 'tools', 'load', 'generate.sql');
export const OWNER_STATE = join(STATE_DIR, 'owner.json');
/** The disk that holds the data of Docker (plan R6): the whole year needs 30 GB free, a part of it its share. */
const DOCKER_DISK = process.env.LOAD_DOCKER_DISK ?? (process.platform === 'win32' ? 'C:/' : '/');
const GB = 2 ** 30;
const HISTORY_DAYS = 365;

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
  const applied = Number(await at('select count(*) from public.pgmigrations'));
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

const freeGb = () => {
  const disk = statfsSync(DOCKER_DISK);
  return (disk.bavail * disk.bsize) / GB;
};

/** One value (or rows) of a query in pharmacy_load, unaligned and without headers. */
export const at = async (sql, vars = {}) => (await psql({ sql: `${sql};` }, vars, { args: ['-At'] })).trim();

/** The calendar day in Dushanbe (the business date of the network), YYYY-MM-DD. */
const dushanbeDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(date);
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The role templates and the starter catalog of a new network, from the sources of libs/shared/domain (the same values
 * the platform passes to provision_tenant): Node strips the types, the hook resolves the extensionless imports.
 */
async function domainDefaults() {
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (error) {
        if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
        throw error;
      }
    },
  });
  const lib = (file) => pathToFileURL(join(ROOT, 'libs', 'shared', 'domain', 'src', 'lib', file)).href;
  const { roleTemplates } = await import(lib('role-templates.ts'));
  const { catalogDefaults } = await import(lib('catalog.ts'));
  // the names of tenants.service.ts (DEFAULT_ROLES): the fleet finds the roles by them
  const roles = [
    ['manager', { ru: 'Заведующий точкой', tj: 'Мудири нуқта' }],
    ['cashier', { ru: 'Фармацевт-кассир', tj: 'Фармасевт-хазинадор' }],
    ['accountant', { ru: 'Бухгалтер', tj: 'Муҳосиб' }],
  ].map(([key, name]) => ({ id: randomUUID(), name, permissions: [...roleTemplates[key].permissions] }));
  const catalog = {
    categories: catalogDefaults.categories.map((category) => ({ id: randomUUID(), name: category.name })),
    dosageForms: catalogDefaults.dosageForms.map((form) => ({ id: randomUUID(), code: form.code, name: form.name })),
  };
  return { roles: JSON.stringify(roles), catalog: JSON.stringify(catalog) };
}

/** A new one-time code of the owner (base32, 26 characters, as the API issues it): kept in .state, never printed. */
function newOwnerCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const state = { login: 'load.owner', code: Array.from({ length: 26 }, () => alphabet[randomInt(32)]).join('') };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(OWNER_STATE, JSON.stringify(state, null, 2));
  return state;
}

const ownerCode = () => (existsSync(OWNER_STATE) ? JSON.parse(readFileSync(OWNER_STATE, 'utf8')) : newOwnerCode());
const codeHash = (code) => createHash('sha256').update(code, 'utf8').digest('hex');

/**
 * A new one-time code for the owner of an activated network (final review M7): the password of .state was lost while
 * the database stays, and the activation code of the generator is spent. Written straight into pharmacy_load, as the
 * operator's «new code» would; the next activation sets a new password.
 */
export async function reissueOwnerCode() {
  const state = await meta();
  const owner = newOwnerCode();
  await at(
    `update pharmacy.employee_credentials
     set one_time_code_hash = :'hash', one_time_code_expires_at = now() + interval '1 day'
     where tenant_id = :'t' and employee_id = :'owner'`,
    { hash: codeHash(owner.code), t: state.tenant_id, owner: state.owner_id },
  );
  return owner;
}

/** Whether the owner of the network already has a password (the code of the generator is spent). */
export async function ownerActivated() {
  const state = await meta();
  const activated = await at(
    `select password_hash is not null from pharmacy.employee_credentials where tenant_id = :'t' and employee_id = :'owner'`,
    { t: state.tenant_id, owner: state.owner_id },
  );
  return activated === 't';
}

/** The parameters the generator recorded (load_gen.meta), or null before the setup. */
export async function meta() {
  if ((await at(`select to_regclass('load_gen.meta') is not null`)) !== 't') return null;
  const rows = await at(`select key || '=' || value from load_gen.meta order by key`);
  return Object.fromEntries(
    rows
      .split('\n')
      .filter(Boolean)
      .map((row) => [row.slice(0, row.indexOf('=')), row.slice(row.indexOf('=') + 1)]),
  );
}

const generator = (phase, vars) => psql({ file: GENERATOR }, { phase, ...vars }, { args: ['-1', '-At'] });
const seconds = (t0) => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

async function generate(args) {
  const scaleArg = args.indexOf('--scale');
  const scale = scaleArg === -1 ? 1 : Number(args[scaleArg + 1]);
  if (!(scale > 0 && scale <= 2)) throw new Error('--scale is a number above 0, at most 2');
  const started = Date.now();
  let state = await meta();
  if (state === null) {
    const need = Math.max(2, 30 * scale);
    const free = freeGb();
    if (free < need) {
      throw new Error(
        `${free.toFixed(1)} GB free on ${DOCKER_DISK}, the scale ${scale} needs ${need} GB: ` +
          'free the disk or take a smaller --scale (docs/guides/load-test.md)',
      );
    }
    const today = dushanbeDay(new Date());
    const owner = ownerCode();
    const { roles, catalog } = await domainDefaults();
    const t0 = Date.now();
    await generator('setup', {
      scale,
      today,
      history_from: addDays(today, -HISTORY_DAYS),
      tenant_id: randomUUID(),
      owner_id: randomUUID(),
      owner_role_id: randomUUID(),
      owner_code_hash: codeHash(owner.code),
      roles,
      catalog,
    });
    state = await meta();
    console.log(
      `setup: the network «Нагрузка», 30 stores, 3000 products, history ${state.history_from} … ` +
        `${addDays(state.today, -1)} — ${seconds(t0)}`,
    );
  } else if (Number(state.scale) !== scale) {
    throw new Error(`the database holds the scale ${state.scale}: drop it, or generate with --scale ${state.scale}`);
  }

  const loaded = new Set((await at('select month_start::text from load_gen.month')).split('\n').filter(Boolean));
  const months = [];
  for (let month = `${state.history_from.slice(0, 7)}-01`; month <= state.today; ) {
    months.push(month);
    const next = new Date(`${month}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    month = next.toISOString().slice(0, 10);
  }
  const left = months.filter((month) => !loaded.has(month));
  // a resumed generation checks the rest of it, not only the next month: a disk full of WAL stops the whole dev
  // cluster, not one transaction (final review M5). A month at scale 1 takes about 1.4 GB, its WAL up to 1 GB more
  const monthGb = 3 + 2 * scale;
  const restGb = left.length * 1.5 * scale + 3;
  if (left.length > 0 && freeGb() < restGb) {
    throw new Error(
      `${freeGb().toFixed(1)} GB free on ${DOCKER_DISK}, the ${left.length} months left need ${restGb.toFixed(0)} GB`,
    );
  }
  for (const month of left) {
    // a month is one transaction: a full disk rolls it back, the next run goes on from it (plan, Review Focus 4)
    if (freeGb() < monthGb) throw new Error(`less than ${monthGb} GB free on ${DOCKER_DISK}: stopped before ${month}`);
    const t0 = Date.now();
    const out = await generator('month', { scale, month, today: state.today, history_from: state.history_from });
    const size = await at('select pg_size_pretty(pg_database_size(current_database()))');
    console.log(`${out.trim().split('\n').pop()} — ${seconds(t0)}, database ${size}`);
  }

  if (state.finished_at === undefined) {
    const t0 = Date.now();
    await generator('finish', { today: state.today });
    console.log(`finish: deliveries, counters, keys — ${seconds(t0)}`);
  }
  // the visibility map and the statistics a year of autovacuum would have left (index-only scans of the stock)
  const t0 = Date.now();
  await psql({ sql: 'vacuum (analyze);' });
  console.log(`vacuum (analyze) — ${seconds(t0)}`);
  console.log(`generated in ${((Date.now() - started) / 60000).toFixed(1)} min`);
  process.stdout.write(await size());
}

/**
 * Brings the hot batch of L01 back to at least `packs` packs before a run (final review I3): every hot scenario sells
 * thousands of them, and a run on the same database must not start from an emptied batch. The delivery line of the
 * batch grows by what is added and the batch gets a delivery movement of it — the invariant «stock = delivered − sold»
 * of run.mjs holds. Returns the packs added.
 */
export async function topUpHotBatch(packs) {
  const state = await meta();
  const added = await psql(
    {
      sql: `
select g.id as line_id, g.document_id as doc_id, b.store_id, p.pieces_per_pack as ppp,
       (select coalesce(sum(m.qty_delta_pieces), 0) from pharmacy.stock_movements m
        where m.tenant_id = :'t' and m.batch_id = :'b') as stock
from pharmacy.goods_receipt_lines g
join pharmacy.batches b on b.tenant_id = g.tenant_id and b.id = g.batch_id
join pharmacy.products p on p.tenant_id = g.tenant_id and p.id = g.product_id
where g.tenant_id = :'t' and g.batch_id = :'b' \\gset
select greatest(0, :packs * :ppp - :stock) as add, :packs * :ppp > :stock as needed \\gset
\\if :needed
update pharmacy.goods_receipt_lines set qty_pieces = qty_pieces + :add where tenant_id = :'t' and id = :'line_id';
insert into pharmacy.stock_movements
  (tenant_id, id, recorded_at, store_id, batch_id, qty_delta_pieces, kind, source_type, source_id, source_line_id,
   business_date, origin)
values (:'t', gen_random_uuid(), now(), :'store_id', :'b', :add, 'goods_receipt', 'document', :'doc_id', :'line_id',
        (now() at time zone 'Asia/Dushanbe')::date, 'local');
\\endif
select :add / :ppp;`,
    },
    { t: state.tenant_id, b: state.hot_batch_id, packs },
    { args: ['-1', '-At'] },
  );
  return Number(added.trim());
}

/** The bulk tables whose declared references verify checks one by one (plan R4). */
const CHECKED_TABLES = [
  'receipts',
  'receipt_lines',
  'payments',
  'shifts',
  'batches',
  'documents',
  'goods_receipt_lines',
  'store_products',
  'product_barcodes',
  'products',
  'employees',
  'employee_stores',
  'terminals',
  'stores',
  'document_counters',
  'idempotency_keys',
  'store_sales_daily',
];

// the movements and the audit have no FK but the tenant on their partitions: their references are checked by name
const LOGICAL_REFERENCES = [
  `select 'stock_movements → batches', count(*) from pharmacy.stock_movements c
   where c.tenant_id = :'t' and not exists (
     select 1 from pharmacy.batches p where p.tenant_id = c.tenant_id and p.id = c.batch_id and p.store_id = c.store_id)`,
  `select 'sale movements → receipt_lines', count(*) from pharmacy.stock_movements c
   where c.tenant_id = :'t' and c.kind = 'sale' and not exists (
     select 1 from pharmacy.receipt_lines p
     where p.tenant_id = c.tenant_id and p.id = c.source_line_id and p.receipt_id = c.source_id and p.batch_id = c.batch_id)`,
  `select 'delivery movements → goods_receipt_lines', count(*) from pharmacy.stock_movements c
   where c.tenant_id = :'t' and c.kind = 'goods_receipt' and not exists (
     select 1 from pharmacy.goods_receipt_lines p
     where p.tenant_id = c.tenant_id and p.id = c.source_line_id and p.document_id = c.source_id and p.batch_id = c.batch_id)`,
  `select 'receipt audit → receipts', count(*) from pharmacy.audit_log c
   where c.tenant_id = :'t' and c.action = 'receipt.completed' and not exists (
     select 1 from pharmacy.receipts p where p.tenant_id = c.tenant_id and p.id = c.entity_id)`,
];

const INVARIANTS = [
  `select 'batches below zero', count(*) from (
     select batch_id from pharmacy.stock_movements where tenant_id = :'t' group by batch_id
     having sum(qty_delta_pieces) < 0) x`,
  `select 'receipts: total ≠ subtotal − discount', count(*) from pharmacy.receipts
   where tenant_id = :'t' and total_dirams <> subtotal_dirams - discount_dirams`,
  `select 'receipts: Σ payments ≠ total + change', count(*) from pharmacy.receipts r
   left join (select receipt_id, sum(amount_dirams) as paid from pharmacy.payments where tenant_id = :'t'
              group by receipt_id) p on p.receipt_id = r.id
   where r.tenant_id = :'t' and coalesce(p.paid, 0) <> r.total_dirams + r.change_dirams`,
  `select 'receipts: Σ lines ≠ subtotal', count(*) from pharmacy.receipts r
   left join (select receipt_id, sum(line_amount_dirams) as amount from pharmacy.receipt_lines where tenant_id = :'t'
              group by receipt_id) l on l.receipt_id = r.id
   where r.tenant_id = :'t' and coalesce(l.amount, 0) <> r.subtotal_dirams`,
  `select 'receipts: a line without its movement', count(*) from pharmacy.receipt_lines l
   where l.tenant_id = :'t' and not exists (
     select 1 from pharmacy.stock_movements m where m.tenant_id = l.tenant_id and m.source_line_id = l.id)`,
  `select 'receipt numbers repeated', count(*) from (
     select 1 from pharmacy.receipts where tenant_id = :'t' group by store_id, number having count(*) > 1) x`,
  `select 'counters behind the receipt numbers', count(*) from (
     select store_id, extract(year from business_date)::int as year, max(substring(number from '\\d+$')::bigint) as n
     from pharmacy.receipts where tenant_id = :'t' group by 1, 2) r
   left join pharmacy.document_counters c
     on c.tenant_id = :'t' and c.store_id = r.store_id and c.kind = 'receipt' and c.year = r.year
   where coalesce(c.last_number, 0) < r.n`,
];

async function verify() {
  const state = await meta();
  if (state === null) throw new Error(`${LOAD_DB} has no generated data (node tools/load/db.mjs generate)`);
  const months = await at(
    `select count(*) || ' months loaded, the last ' || coalesce(max(month_start)::text, '—') from load_gen.month`,
  );
  console.log(
    `scale ${state.scale}, history ${state.history_from} … ${addDays(state.today, -1)}; ${months}; ` +
      `finish: ${state.finished_at ?? 'NOT DONE'}`,
  );
  const vars = { t: state.tenant_id };
  const rows = { args: ['-A', '-F', '\t', '-t'] };
  process.stdout.write(
    await psql(
      {
        sql: `
select 'receipts', count(*) from pharmacy.receipts where tenant_id = :'t'
union all select 'receipt lines', count(*) from pharmacy.receipt_lines where tenant_id = :'t'
union all select 'payments', count(*) from pharmacy.payments where tenant_id = :'t'
union all select 'shifts', count(*) from pharmacy.shifts where tenant_id = :'t'
union all (select 'movements ' || kind, count(*) from pharmacy.stock_movements where tenant_id = :'t' group by kind)
union all select 'batches', count(*) from pharmacy.batches where tenant_id = :'t'
union all select 'goods receipts', count(*) from pharmacy.documents where tenant_id = :'t' and type = 'goods_receipt'
union all select 'audit receipt.completed', count(*) from pharmacy.audit_log
          where tenant_id = :'t' and action = 'receipt.completed'
union all select 'idempotency keys', count(*) from pharmacy.idempotency_keys where tenant_id = :'t';`,
      },
      vars,
      rows,
    ),
  );

  // each declared FK of the bulk tables as an anti-join: the generator wrote them with the FK triggers off (plan R4)
  const references = (
    await at(`
select format('select %L, count(*) from pharmacy.%I c where c.tenant_id = :''t'' and %s and not exists (select 1 from pharmacy.%I p where %s)',
              con.conname, c.relname,
              (select string_agg(format('c.%I is not null', a.attname), ' and ')
               from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k),
              f.relname,
              (select string_agg(format('p.%I = c.%I', fa.attname, ca.attname), ' and ')
               from unnest(con.confkey, con.conkey) as k(fk, ck)
               join pg_attribute fa on fa.attrelid = con.confrelid and fa.attnum = k.fk
               join pg_attribute ca on ca.attrelid = con.conrelid and ca.attnum = k.ck))
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_class f on f.oid = con.confrelid
join pg_namespace n on n.oid = c.relnamespace
where con.contype = 'f' and n.nspname = 'pharmacy' and c.relname = any (array['${CHECKED_TABLES.join("','")}'])
order by 1`)
  )
    .split('\n')
    .filter(Boolean);
  const checks = [...references, ...LOGICAL_REFERENCES, ...INVARIANTS];
  const out = await psql({ sql: `${checks.join(';\n')};` }, vars, rows);
  const failed = out
    .split('\n')
    .filter(Boolean)
    .map((row) => row.split('\t'))
    .filter(([, count]) => Number(count) !== 0);
  console.log(
    `${checks.length} checks: ${references.length} declared references, ${LOGICAL_REFERENCES.length} references ` +
      `of the movements and the audit, ${INVARIANTS.length} invariants — ${failed.length === 0 ? 'all 0' : 'FAILED'}`,
  );
  for (const [name, count] of failed) console.log(`FAILED ${name}: ${count}`);
  process.stdout.write(await size());
  if (failed.length > 0 || state.finished_at === undefined) process.exitCode = 1;
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
  generate: async () => generate(process.argv.slice(3)),
  verify,
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
