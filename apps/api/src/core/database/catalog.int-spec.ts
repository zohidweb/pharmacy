import { closeAll, ownerPool } from '../../../test/integration/connections';
import {
  APPEND_ONLY_TABLES,
  PROVISIONING_FUNCTIONS,
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

// Every table privilege type of PostgreSQL 17 (MAINTAIN is new in 17).
const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
] as const;
type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

const RUNTIME_ROLES = ['pharmacy_app', 'pharmacy_platform', 'pharmacy_resolver'];

// Table-level privileges of a role on manifest tables compared with an allowed set; 'exact' also
// reports an allowed privilege the role lacks. has_table_privilege counts direct grants, grants to
// PUBLIC and inherited role memberships. Each violation names the role, the table and the privilege.
async function tablePrivilegeViolations(
  role: string,
  tables: string[],
  allowed: readonly TablePrivilege[],
  mode: 'exact' | 'at most',
): Promise<string[]> {
  const rows = await query<{
    name: string;
    missing: boolean;
    privileges: string[];
  }>(
    `select t.name, t.oid is null as missing,
            coalesce(array_agg(p.privilege order by p.privilege)
                       filter (where has_table_privilege($2, t.oid, p.privilege)), '{}'::text[]) as privileges
     from (${MANIFEST_TABLES}) t
     cross join unnest($3::text[]) as p(privilege)
     group by t.name, t.oid
     order by 1`,
    [tables, role, TABLE_PRIVILEGES],
  );
  return rows.flatMap((row) => {
    if (row.missing) return [`${role} on ${row.name}: table missing`];
    const extra = row.privileges
      .filter((privilege) => !allowed.includes(privilege as TablePrivilege))
      .map((privilege) => `${role} on ${row.name}: has ${privilege}`);
    const lacking =
      mode === 'exact'
        ? allowed
            .filter((privilege) => !row.privileges.includes(privilege))
            .map((privilege) => `${role} on ${row.name}: lacks ${privilege}`)
        : [];
    return [...extra, ...lacking];
  });
}

describe('database catalog (ADR-0013 p. 8)', () => {
  it('every table in schema pharmacy is in TABLE_CLASSES and vice versa', async () => {
    // Partitions inherit the class of their parent and are checked separately below.
    const rows = await query<{ name: string }>(
      `select relname as name from pg_class
       where relnamespace = 'pharmacy'::regnamespace and relkind in ('r', 'p') and not relispartition
       order by 1`,
    );
    // Views, materialized views and foreign tables escape the manifest and its isolation checks,
    // so none may exist in the schema (pg_trgm creates no relations).
    const otherRelations = await query<{ violation: string }>(
      `select relname || ': ' || case relkind when 'v' then 'view'
                                              when 'm' then 'materialized view'
                                              else 'foreign table' end as violation
       from pg_class
       where relnamespace = 'pharmacy'::regnamespace and relkind in ('v', 'm', 'f')
       order by 1`,
    );
    const actual = rows.map((row) => row.name);
    const manifest = Object.keys(TABLE_CLASSES).sort();
    expect({
      notInManifest: actual.filter(
        (table) => !Object.hasOwn(TABLE_CLASSES, table),
      ),
      missingInDatabase: manifest.filter((table) => !actual.includes(table)),
      notATable: otherRelations.map((row) => row.violation),
    }).toEqual({ notInManifest: [], missingInDatabase: [], notATable: [] });
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

  it('pharmacy_app has exactly SELECT, INSERT, UPDATE, DELETE on tenant tables', async () => {
    expect(
      await tablePrivilegeViolations(
        'pharmacy_app',
        tablesOf('tenant').filter((table) => !APPEND_ONLY_TABLES.includes(table)),
        ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        'exact',
      ),
    ).toEqual([]);
  });

  it('pharmacy_app has exactly SELECT, INSERT on append-only tables', async () => {
    expect(
      await tablePrivilegeViolations(
        'pharmacy_app',
        [...APPEND_ONLY_TABLES].sort(),
        ['SELECT', 'INSERT'],
        'exact',
      ),
    ).toEqual([]);
  });

  it('partitions have a parent in TABLE_CLASSES and no privileges for runtime roles', async () => {
    // Access goes through the parent only: its RLS policies do not apply to a partition queried
    // directly, so any privilege on a partition would bypass tenant isolation.
    const rows = await query<{ violation: string }>(
      `select c.relname || ': parent ' || parent.relname || ' not in manifest' as violation
       from pg_class c
       join pg_inherits i on i.inhrelid = c.oid
       join pg_class parent on parent.oid = i.inhparent
       where c.relnamespace = 'pharmacy'::regnamespace and c.relkind in ('r', 'p') and c.relispartition
         and not (parent.relname = any($1::text[]))
       union all
       select r.role || ' on ' || c.relname || ': has ' || p.privilege
       from pg_class c
       cross join unnest($2::text[]) as r(role)
       cross join unnest($3::text[]) as p(privilege)
       where c.relnamespace = 'pharmacy'::regnamespace and c.relkind in ('r', 'p') and c.relispartition
         and (has_table_privilege(r.role, c.oid, p.privilege)
              or (p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                  and has_any_column_privilege(r.role, c.oid, p.privilege)))
       order by 1`,
      [Object.keys(TABLE_CLASSES), RUNTIME_ROLES, TABLE_PRIVILEGES],
    );
    expect(rows.map((row) => row.violation)).toEqual([]);
  });

  it('pharmacy_app has at most SELECT on platform tables', async () => {
    const tableLevel = await tablePrivilegeViolations(
      'pharmacy_app',
      tablesOf('platform'),
      ['SELECT'],
      'at most',
    );
    const columnLevel = await query<{ violation: string }>(
      `select 'pharmacy_app on ' || t.name || ': column ' || p.privilege as violation
       from (${MANIFEST_TABLES}) t
       cross join unnest(array['INSERT', 'UPDATE', 'REFERENCES']) as p(privilege)
       where t.oid is not null and has_any_column_privilege('pharmacy_app', t.oid, p.privilege)
       order by 1`,
      [tablesOf('platform')],
    );
    expect([...tableLevel, ...columnLevel.map((row) => row.violation)]).toEqual(
      [],
    );
  });

  it('pharmacy_platform has at most SELECT, INSERT, UPDATE on platform tables', async () => {
    expect(
      await tablePrivilegeViolations(
        'pharmacy_platform',
        tablesOf('platform'),
        ['SELECT', 'INSERT', 'UPDATE'],
        'at most',
      ),
    ).toEqual([]);
  });

  it('no runtime role has TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any pharmacy table', async () => {
    // Every relation of the schema, not only the manifest; column-level REFERENCES counts too.
    const rows = await query<{ violation: string }>(
      `select r.role || ' on ' || c.relname || ': has ' || p.privilege as violation
       from pg_class c
       cross join unnest($1::text[]) as r(role)
       cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(privilege)
       where c.relnamespace = 'pharmacy'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and has_table_privilege(r.role, c.oid, p.privilege)
       union all
       select r.role || ' on ' || c.relname || ': has column REFERENCES'
       from pg_class c
       cross join unnest($1::text[]) as r(role)
       where c.relnamespace = 'pharmacy'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and not has_table_privilege(r.role, c.oid, 'REFERENCES')
         and has_any_column_privilege(r.role, c.oid, 'REFERENCES')
       order by 1`,
      [RUNTIME_ROLES],
    );
    expect(rows.map((row) => row.violation)).toEqual([]);
  });

  it('pharmacy_platform has no table privileges on tenant tables and only the registry columns of stores', async () => {
    const tableLevel = await tablePrivilegeViolations(
      'pharmacy_platform',
      tablesOf('tenant'),
      [],
      'exact',
    );
    const columnLevel = await query<{ violation: string }>(
      `select 'pharmacy_platform on ' || t.name || ': column ' || p.privilege as violation
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
      tableLevel,
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

  it('security definer functions are exactly the resolvers and the provisioning functions', async () => {
    const rows = await query<{
      name: string;
      owner: string;
      pinned: boolean;
      publicExecute: boolean;
      appExecute: boolean;
    }>(
      `select p.proname as name,
              pg_get_userbyid(p.proowner) as owner,
              coalesce((select bool_or(setting like 'search_path=%') from unnest(p.proconfig) as s(setting)), false)
                as pinned,
              has_function_privilege('public', p.oid, 'EXECUTE') as "publicExecute",
              has_function_privilege('pharmacy_app', p.oid, 'EXECUTE') as "appExecute"
       from pg_proc p
       where p.prosecdef and p.pronamespace in ('pharmacy'::regnamespace, 'public'::regnamespace)
       order by 1`,
    );
    // Each class has its own owner: resolvers only read, provisioning functions only write.
    const expectedOwner = (name: string): string | null =>
      RESOLVER_FUNCTIONS.includes(name)
        ? 'pharmacy_resolver'
        : PROVISIONING_FUNCTIONS.includes(name)
          ? 'pharmacy_provisioner'
          : null;
    const listed = [...RESOLVER_FUNCTIONS, ...PROVISIONING_FUNCTIONS];
    const violations = [
      ...rows
        .filter((row) => expectedOwner(row.name) === null)
        .map((row) => `${row.name}: not a resolver or a provisioning function`),
      ...listed
        .filter((name) => !rows.some((row) => row.name === name))
        .map((name) => `${name}: missing`),
      ...rows
        .filter((row) => {
          const owner = expectedOwner(row.name);
          return owner !== null && row.owner !== owner;
        })
        .map((row) => `${row.name}: owner ${row.owner}`),
      ...rows
        .filter((row) => !row.pinned)
        .map((row) => `${row.name}: search_path not set`),
      ...rows
        .filter((row) => row.publicExecute)
        .map((row) => `${row.name}: EXECUTE granted to PUBLIC`),
      // The tenant path never provisions: only pharmacy_platform calls these.
      ...rows
        .filter((row) => PROVISIONING_FUNCTIONS.includes(row.name) && row.appExecute)
        .map((row) => `${row.name}: EXECUTE granted to pharmacy_app`),
    ];
    expect(violations).toEqual([]);
  });

  it('pharmacy_resolver cannot write any pharmacy table', async () => {
    const rows = await query<{ violation: string }>(
      `select 'pharmacy_resolver on ' || c.relname || ': ' || p.privilege as violation
       from pg_class c
       cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
       where c.relnamespace = 'pharmacy'::regnamespace and c.relkind in ('r', 'p')
         and (has_table_privilege('pharmacy_resolver', c.oid, p.privilege)
              or (p.privilege in ('INSERT', 'UPDATE')
                  and has_any_column_privilege('pharmacy_resolver', c.oid, p.privilege)))
       order by 1`,
    );
    expect(rows.map((row) => row.violation)).toEqual([]);
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

  it('no role- or database-level default for app.* settings', async () => {
    // A default app.tenant_id / app.actor would give every connection a context before
    // set_config(..., true) runs, defeating the fail-closed tenant filter.
    const rows = await query<{ violation: string }>(
      `select coalesce(d.datname, 'all databases') || ' / ' || coalesce(r.rolname, 'all roles')
                || ': ' || s.setting as violation
       from pg_db_role_setting rs
       cross join lateral unnest(rs.setconfig) as s(setting)
       left join pg_database d on d.oid = rs.setdatabase
       left join pg_roles r on r.oid = rs.setrole
       where s.setting like 'app.%'
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
