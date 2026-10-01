import { closeAll, ownerPool } from '../../../test/integration/connections';
import {
  RESOLVER_FUNCTIONS,
  STORE_PLATFORM_COLUMNS,
  TABLE_CLASSES,
  type TableClass,
} from './table-classes';

// Catalog checks of ADR-0013 p. 8: the schema in pg_catalog must match the table-class manifest.
// Each test collects violations and compares them with an empty list, so a failure names the offenders.

afterAll(closeAll);

function tablesOf(...classes: TableClass[]): string[] {
  return Object.entries(TABLE_CLASSES)
    .filter(([, tableClass]) => classes.includes(tableClass))
    .map(([table]) => table)
    .sort();
}

async function query<T extends object>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const { rows } = await ownerPool().query<T>(text, values);
  return rows;
}

// Tables of the manifest resolved in the pharmacy schema; oid is null for a missing table.
const MANIFEST_TABLES = `
  select t.name, c.oid
  from unnest($1::text[]) as t(name)
  left join pg_class c
    on c.relname = t.name and c.relnamespace = 'pharmacy'::regnamespace and c.relkind in ('r', 'p')`;

describe('database catalog (ADR-0013 p. 8)', () => {
  it('every table in schema pharmacy is in TABLE_CLASSES and vice versa', async () => {
    const rows = await query<{ name: string }>(
      `select relname as name from pg_class
       where relnamespace = 'pharmacy'::regnamespace and relkind in ('r', 'p')
       order by 1`,
    );
    const actual = rows.map((row) => row.name);
    const manifest = Object.keys(TABLE_CLASSES).sort();
    expect({
      notInManifest: actual.filter(
        (table) => !Object.hasOwn(TABLE_CLASSES, table),
      ),
      missingInDatabase: manifest.filter((table) => !actual.includes(table)),
    }).toEqual({ notInManifest: [], missingInDatabase: [] });
  });

  it('RLS is enabled and forced on tenant, tenant-export, platform and system tables', async () => {
    const rows = await query<{ name: string; problem: string }>(
      `select t.name,
              case when c.oid is null then 'missing'
                   when not c.relrowsecurity then 'rls not enabled'
                   else 'rls not forced' end as problem
       from (${MANIFEST_TABLES}) t
       left join pg_class c on c.oid = t.oid
       where c.oid is null or not c.relrowsecurity or not c.relforcerowsecurity
       order by 1`,
      [tablesOf('tenant', 'tenant-export', 'platform', 'system')],
    );
    expect(rows.map((row) => `${row.name}: ${row.problem}`)).toEqual([]);
  });

  it('pharmacy_app has no insert/update/delete on platform tables', async () => {
    const rows = await query<{ violation: string }>(
      `select t.name || ': ' || coalesce(p.privilege, 'missing') as violation
       from (${MANIFEST_TABLES}) t
       left join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
         on t.oid is not null
       where t.oid is null
          or has_table_privilege('pharmacy_app', t.oid, p.privilege)
          or (p.privilege in ('INSERT', 'UPDATE')
              and has_any_column_privilege('pharmacy_app', t.oid, p.privilege))
       order by 1`,
      [tablesOf('platform')],
    );
    expect(rows.map((row) => row.violation)).toEqual([]);
  });

  it('pharmacy_platform has no table privileges on tenant tables and only the registry columns of stores', async () => {
    const tableLevel = await query<{ violation: string }>(
      `select t.name || ': ' || coalesce(p.privilege, 'missing') as violation
       from (${MANIFEST_TABLES}) t
       left join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
         as p(privilege) on t.oid is not null
       where t.oid is null or has_table_privilege('pharmacy_platform', t.oid, p.privilege)
       order by 1`,
      [tablesOf('tenant')],
    );
    const columnLevel = await query<{ violation: string }>(
      `select t.name || ': column ' || p.privilege as violation
       from (${MANIFEST_TABLES}) t
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p(privilege)
       where t.oid is not null and t.name <> 'stores'
         and has_any_column_privilege('pharmacy_platform', t.oid, p.privilege)
       order by 1`,
      [tablesOf('tenant')],
    );
    const storeColumns = async (privilege: string): Promise<string[]> =>
      (
        await query<{ name: string }>(
          `select attname as name from pg_attribute
           where attrelid = to_regclass('pharmacy.stores') and attnum > 0 and not attisdropped
             and has_column_privilege('pharmacy_platform', attrelid, attnum, $1)
           order by 1`,
          [privilege],
        )
      ).map((row) => row.name);

    expect({
      tableLevel: tableLevel.map((row) => row.violation),
      columnLevel: columnLevel.map((row) => row.violation),
      storesSelect: await storeColumns('SELECT'),
      storesUpdate: await storeColumns('UPDATE'),
      storesInsert: await storeColumns('INSERT'),
      storesReferences: await storeColumns('REFERENCES'),
    }).toEqual({
      tableLevel: [],
      columnLevel: [],
      storesSelect: [...STORE_PLATFORM_COLUMNS].sort(),
      storesUpdate: ['mode'],
      storesInsert: [],
      storesReferences: [],
    });
  });

  it('only superusers bypass RLS', async () => {
    const rows = await query<{ rolname: string }>(
      'select rolname from pg_roles where rolbypassrls and not rolsuper order by 1',
    );
    expect(rows.map((row) => row.rolname)).toEqual([]);
  });

  it('security definer functions are exactly the resolver list', async () => {
    const rows = await query<{
      name: string;
      owner: string;
      pinned: boolean;
      publicExecute: boolean;
    }>(
      `select p.proname as name,
              pg_get_userbyid(p.proowner) as owner,
              coalesce((select bool_or(setting like 'search_path=%') from unnest(p.proconfig) as s(setting)), false)
                as pinned,
              has_function_privilege('public', p.oid, 'EXECUTE') as "publicExecute"
       from pg_proc p
       where p.prosecdef and p.pronamespace in ('pharmacy'::regnamespace, 'public'::regnamespace)
       order by 1`,
    );
    const violations = [
      ...rows
        .filter((row) => !RESOLVER_FUNCTIONS.includes(row.name))
        .map((row) => `${row.name}: not a resolver`),
      ...RESOLVER_FUNCTIONS.filter(
        (name) => !rows.some((row) => row.name === name),
      ).map((name) => `${name}: missing`),
      ...rows
        .filter((row) => row.owner !== 'pharmacy_resolver')
        .map((row) => `${row.name}: owner ${row.owner}`),
      ...rows
        .filter((row) => !row.pinned)
        .map((row) => `${row.name}: search_path not set`),
      ...rows
        .filter((row) => row.publicExecute)
        .map((row) => `${row.name}: EXECUTE granted to PUBLIC`),
    ];
    expect(violations).toEqual([]);
  });

  it('pharmacy_app is not a member of pharmacy_platform or pharmacy_resolver', async () => {
    const rows = await query<{ platform: boolean; resolver: boolean }>(
      `select pg_has_role('pharmacy_app', 'pharmacy_platform', 'MEMBER') as platform,
              pg_has_role('pharmacy_app', 'pharmacy_resolver', 'MEMBER') as resolver`,
    );
    expect(rows[0]).toEqual({ platform: false, resolver: false });
  });

  it('no policy targets public, tenant policies target pharmacy_app', async () => {
    const policies = await query<{
      table: string;
      name: string;
      roles: string[];
      cmd: string;
      qual: string | null;
      withCheck: string | null;
    }>(
      `select tablename as table, policyname as name, roles::text[] as roles, cmd, qual, with_check as "withCheck"
       from pg_policies where schemaname = 'pharmacy' order by 1, 2`,
    );
    const isFailClosedTenantFilter = (expression: string | null): boolean =>
      expression !== null &&
      expression.startsWith('(tenant_id = ') &&
      expression.includes("current_setting('app.tenant_id'::text)") &&
      !expression.includes('true)');

    const violations = policies
      .filter((policy) => policy.roles.includes('public'))
      .map((policy) => `${policy.table}.${policy.name}: targets public`);
    for (const table of tablesOf('tenant', 'tenant-export')) {
      const own = policies.filter((policy) => policy.table === table);
      const isolation = own.find(
        (policy) => policy.name === 'tenant_isolation',
      );
      if (!isolation) {
        violations.push(`${table}: no tenant_isolation policy`);
        continue;
      }
      if (isolation.roles.join(',') !== 'pharmacy_app')
        violations.push(`${table}: tenant_isolation roles ${isolation.roles}`);
      if (isolation.cmd !== 'ALL')
        violations.push(`${table}: tenant_isolation cmd ${isolation.cmd}`);
      if (
        !isFailClosedTenantFilter(isolation.qual) ||
        isolation.withCheck !== isolation.qual
      ) {
        violations.push(
          `${table}: tenant_isolation is not the fail-closed tenant filter`,
        );
      }
      own
        .filter(
          (policy) =>
            policy.name !== 'tenant_isolation' &&
            policy.roles.includes('pharmacy_app'),
        )
        .forEach((policy) =>
          violations.push(`${table}.${policy.name}: extra pharmacy_app policy`),
        );
    }
    expect(violations).toEqual([]);
  });

  it('no default privileges grant anything to pharmacy_app', async () => {
    const rows = await query<{ violation: string }>(
      `select pg_get_userbyid(d.defaclrole) || ' ' || d.defaclobjtype::text || ' ' || a.privilege_type
                || ' to ' || case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as violation
       from pg_default_acl d
       cross join lateral aclexplode(d.defaclacl) a
       where a.grantee in (0::oid, 'pharmacy_app'::regrole::oid)
       order by 1`,
    );
    expect(rows.map((row) => row.violation)).toEqual([]);
  });

  it('every tenant-class table has tenant_id leading its primary key', async () => {
    const rows = await query<{ name: string; firstColumn: string | null }>(
      `select t.name, a.attname as "firstColumn"
       from (${MANIFEST_TABLES}) t
       left join pg_index i on i.indrelid = t.oid and i.indisprimary
       left join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
       order by 1`,
      [tablesOf('tenant', 'tenant-export')],
    );
    expect(
      rows
        .filter((row) => row.firstColumn !== 'tenant_id')
        .map((row) => `${row.name}: ${row.firstColumn ?? 'no primary key'}`),
    ).toEqual([]);
  });

  it('no id column has a default', async () => {
    const rows = await query<{ name: string }>(
      `select c.relname as name
       from pg_attrdef d
       join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
       join pg_class c on c.oid = d.adrelid
       where c.relnamespace = 'pharmacy'::regnamespace and a.attname = 'id'
       order by 1`,
    );
    expect(rows.map((row) => row.name)).toEqual([]);
  });
});
