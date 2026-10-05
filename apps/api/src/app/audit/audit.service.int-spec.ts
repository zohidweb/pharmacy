import { ConfigService } from '@nestjs/config';
import { closeAll } from '../../../test/integration/connections';
import { testDatabaseUrls } from '../../../test/integration/database-urls';
import {
  asTenant,
  seedEmployee,
  seedTenant,
  type SeededTenant,
} from '../../../test/integration/seed';
import {
  type EmployeePrincipal,
  runWithContext,
  TenantContextMissingError,
} from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { AuditService } from './audit.service';

// AuditService.append on the real schema as pharmacy_app (RLS): the context supplies tenant,
// employee, terminal and correlation id; business_date is today in the tenant's time zone;
// source follows STORE_MODE. Without a tenant context nothing is written.

const TERMINAL = '0197a1b2-0000-7000-8000-00000000c0f1';

let db: TenantDatabase;
let a: SeededTenant;
let b: SeededTenant;
let employeeId: string;

const service = (storeMode: 'cloud' | 'offline') =>
  new AuditService(new ConfigService({ STORE_MODE: storeMode }));

function principalOf(
  tenant: SeededTenant,
  overrides: Partial<EmployeePrincipal> = {},
): EmployeePrincipal {
  return {
    kind: 'employee',
    tenantId: tenant.tenantId,
    employeeId,
    sessionId: 'audit-it-session',
    auth: 'password',
    authenticatedAt: new Date().toISOString(),
    permissions: [],
    storeScope: 'all',
    currentStoreId: tenant.storeId,
    terminalId: null,
    locale: 'ru',
    ...overrides,
  };
}

interface AuditRow {
  tenant_id: string;
  employee_id: string | null;
  terminal_id: string | null;
  store_id: string | null;
  correlation_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  source: string;
  business_date: string;
  expected_date: string;
}

async function rowsOf(
  tenantId: string,
  correlationId: string,
): Promise<AuditRow[]> {
  return asTenant(tenantId, async (client) => {
    const { rows } = await client.query<AuditRow>(
      `select tenant_id, employee_id, terminal_id, store_id, correlation_id, action, entity_type,
              entity_id, details, source, business_date::text as business_date,
              (now() at time zone coalesce(
                 (select timezone from tenant_settings where tenant_id = $1), 'Asia/Dushanbe'
               ))::date::text as expected_date
       from audit_log where correlation_id = $2 order by recorded_at`,
      [tenantId, correlationId],
    );
    return rows;
  });
}

beforeAll(async () => {
  db = new TenantDatabase({
    url: testDatabaseUrls(process.env).app,
    poolMax: 2,
    statementTimeoutMs: 5000,
    lockTimeoutMs: 2000,
    connectionTimeoutMs: 5000,
  });
  a = await seedTenant('audit-svc-a');
  b = await seedTenant('audit-svc-b');
  ({ employeeId } = await seedEmployee(a.tenantId, {
    login: 'audit-svc-employee',
  }));
  // Tenant b is far east of UTC, so its business date differs from UTC for half of the day.
  await asTenant(b.tenantId, (client) =>
    client.query(
      `insert into tenant_settings (tenant_id, timezone) values ($1, 'Pacific/Kiritimati')`,
      [b.tenantId],
    ),
  );
});

afterAll(async () => {
  await db.onModuleDestroy();
  await closeAll();
});

describe('AuditService.append (integration)', () => {
  it('writes the event with tenant, employee, correlation id and the event fields', async () => {
    const correlationId = 'audit-it-1';
    const entityId = '0197a1b2-0000-7000-8000-00000000c0e1';

    await runWithContext(
      { correlationId, tenantId: a.tenantId, principal: principalOf(a) },
      () =>
        db.tenantTransaction((trx) =>
          service('cloud').append(trx, {
            action: 'role.changed',
            entityType: 'role',
            entityId,
            storeId: a.storeId,
            details: { permission: 'roles:manage' },
          }),
        ),
    );

    const rows = await rowsOf(a.tenantId, correlationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: a.tenantId,
      employee_id: employeeId,
      terminal_id: null,
      store_id: a.storeId,
      correlation_id: correlationId,
      action: 'role.changed',
      entity_type: 'role',
      entity_id: entityId,
      details: { permission: 'roles:manage' },
      source: 'cloud',
    });
    expect(rows[0].business_date).toBe(rows[0].expected_date);
  });

  it('takes the terminal from a PIN principal and writes offline_store outside the cloud', async () => {
    const correlationId = 'audit-it-2';

    await runWithContext(
      {
        correlationId,
        tenantId: a.tenantId,
        principal: principalOf(a, { auth: 'pin', terminalId: TERMINAL }),
      },
      () =>
        db.tenantTransaction((trx) =>
          service('offline').append(trx, { action: 'auth.pin-succeeded' }),
        ),
    );

    const [row] = await rowsOf(a.tenantId, correlationId);
    expect(row).toMatchObject({
      terminal_id: TERMINAL,
      store_id: null,
      entity_type: null,
      entity_id: null,
      details: {},
      source: 'offline_store',
    });
  });

  it('writes a context without a principal with null employee and terminal', async () => {
    const correlationId = 'audit-it-3';

    await runWithContext(
      { correlationId, tenantId: a.tenantId, principal: null },
      () =>
        db.tenantTransaction((trx) =>
          service('cloud').append(trx, { action: 'auth.login-failed' }),
        ),
    );

    const [row] = await rowsOf(a.tenantId, correlationId);
    expect(row).toMatchObject({
      employee_id: null,
      terminal_id: null,
      action: 'auth.login-failed',
    });
  });

  it('uses the tenant time zone for business_date', async () => {
    const correlationId = 'audit-it-4';

    await runWithContext(
      { correlationId, tenantId: b.tenantId, principal: null },
      () =>
        db.tenantTransaction((trx) =>
          service('cloud').append(trx, { action: 'settings.viewed' }),
        ),
    );

    const [row] = await rowsOf(b.tenantId, correlationId);
    expect(row.business_date).toBe(row.expected_date);
    const kiritimati = await asTenant(
      b.tenantId,
      async (client) =>
        (
          await client.query<{ d: string }>(
            `select (now() at time zone 'Pacific/Kiritimati')::date::text as d`,
          )
        ).rows[0].d,
    );
    expect(row.business_date).toBe(kiritimati);
  });

  it('throws without a tenant context and writes nothing', async () => {
    await expect(
      db.withTenant(a.tenantId, (trx) =>
        service('cloud').append(trx, { action: 'access.denied' }),
      ),
    ).rejects.toBeInstanceOf(TenantContextMissingError);
  });
});
