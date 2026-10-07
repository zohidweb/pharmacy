import { Injectable } from '@nestjs/common';
import type {
  StoreSummary,
  TenantDetails,
  TenantListFilter,
  TenantListItem,
  TenantSortKey,
} from '@pharmacy/shared-dto';
import { type Expression, type SqlBool, sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

export interface TenantListParams {
  filter: TenantListFilter;
  q: string | null;
  sort: TenantSortKey;
  direction: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface ProvisionInput {
  tenantId: string;
  code: string;
  name: string;
  city: string;
  inn: string;
  ownerEmployeeId: string;
  ownerRoleId: string;
  ownerRoleName: Record<string, string>;
  owner: { fullName: string; login: string; phone: string; email: string | null };
  codeHash: string;
  codeExpiresAt: Date;
  /** Ordinary roles of the new network (spec 2026-10-06-staff-design, section 3). */
  defaultRoles: ReadonlyArray<{
    id: string;
    name: { ru: string; tj: string };
    permissions: readonly string[];
  }>;
}

type TenantRow = {
  id: string;
  name: string;
  city: string;
  billingTaxId: string | null;
  ownerFullName: string | null;
  ownerLogin: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  status: string;
  createdAt: Date | string;
  blockedAt: Date | string | null;
  blockReason: string | null;
  blockedByName: string | null;
  cloudStores: number | string | bigint;
  offlineStores: number | string | bigint;
};

// `%`, `_` and the escape character itself are literal in a search term.
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const dateOnly = (value: Date | string): string =>
  new Date(value).toISOString().slice(0, 10);

// Billing does not exist yet (spec 2026-10-05-tenants-module, T1): these fields are neutral.
function toListItem(row: TenantRow): TenantListItem {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    owner: {
      fullName: row.ownerFullName ?? '',
      phone: row.ownerPhone ?? '',
      login: row.ownerLogin ?? '',
      ...(row.ownerEmail ? { email: row.ownerEmail } : {}),
    },
    status: row.status === 'blocked' ? 'blocked' : 'active',
    overdue: false,
    cloudStores: Number(row.cloudStores),
    offlineStores: Number(row.offlineStores),
    paidUntil: null,
    monthlyChargeMinor: 0,
  };
}

// The platform path (ADR-0013): only the tenants registry and the store registry columns are read;
// tenant data is written only through the provisioning functions (amendment 2026-10-05).
@Injectable()
export class TenantsRepository {
  private base(trx: Transaction<DB>) {
    return trx
      .selectFrom('tenants')
      .leftJoin('operators', 'operators.id', 'tenants.blockedBy')
      .select((eb) => [
        'tenants.id',
        'tenants.name',
        'tenants.city',
        'tenants.billingTaxId',
        'tenants.ownerFullName',
        'tenants.ownerLogin',
        'tenants.ownerPhone',
        'tenants.ownerEmail',
        'tenants.status',
        'tenants.createdAt',
        'tenants.blockedAt',
        'tenants.blockReason',
        'operators.fullName as blockedByName',
        eb
          .selectFrom('stores')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('stores.tenantId', '=', 'tenants.id')
          .where('stores.status', '=', 'active')
          .where('stores.mode', '=', 'online')
          .as('cloudStores'),
        eb
          .selectFrom('stores')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('stores.tenantId', '=', 'tenants.id')
          .where('stores.status', '=', 'active')
          .where('stores.mode', '<>', 'online')
          .as('offlineStores'),
      ]);
  }

  // Case-insensitive search over the registry and the owner's contact (spec, section 3).
  private search(q: string): Expression<SqlBool> {
    const pattern = likePattern(q);
    return sql<SqlBool>`(tenants.name ilike ${pattern} or tenants.city ilike ${pattern}
      or tenants.billing_tax_id ilike ${pattern} or tenants.owner_full_name ilike ${pattern}
      or tenants.owner_login ilike ${pattern})`;
  }

  async list(
    trx: Transaction<DB>,
    params: TenantListParams,
  ): Promise<{ items: TenantListItem[]; total: number; counts: Record<TenantListFilter, number> }> {
    let query = this.base(trx);
    if (params.q) query = query.where(this.search(params.q));

    // Counts per filter over the same search ('unpaid' needs billing: 0 until then).
    let countQuery = trx
      .selectFrom('tenants')
      .select([
        sql<string>`count(*)`.as('all'),
        sql<string>`count(*) filter (where status = 'active')`.as('active'),
        sql<string>`count(*) filter (where status = 'blocked')`.as('blocked'),
      ]);
    if (params.q) countQuery = countQuery.where(this.search(params.q));
    const countRow = await countQuery.executeTakeFirstOrThrow();
    const counts: Record<TenantListFilter, number> = {
      all: Number(countRow.all),
      active: Number(countRow.active),
      blocked: Number(countRow.blocked),
      unpaid: 0,
    };

    if (params.filter === 'active' || params.filter === 'blocked') {
      query = query.where('tenants.status', '=', params.filter);
    } else if (params.filter === 'unpaid') {
      query = query.where(sql<SqlBool>`false`);
    }
    const total = params.filter === 'unpaid' ? 0 : counts[params.filter];

    const direction = params.direction;
    // paidUntil and monthlyCharge need billing: until then they sort like name.
    const ordered =
      params.sort === 'owner'
        ? query.orderBy('tenants.ownerFullName', direction)
        : params.sort === 'stores'
          ? query.orderBy(
              sql`(select count(*) from pharmacy.stores s where s.tenant_id = tenants.id and s.status = 'active')`,
              direction,
            )
          : query.orderBy('tenants.name', direction);
    const rows = (await ordered
      .orderBy('tenants.id')
      .limit(params.limit)
      .offset(params.offset)
      .execute()) as TenantRow[];
    return { items: rows.map(toListItem), total, counts };
  }

  async details(trx: Transaction<DB>, tenantId: string): Promise<TenantDetails | null> {
    const row = (await this.base(trx)
      .where('tenants.id', '=', tenantId)
      .executeTakeFirst()) as TenantRow | undefined;
    if (!row) return null;
    return {
      ...toListItem(row),
      inn: row.billingTaxId ?? '',
      joinedOn: dateOnly(row.createdAt),
      block:
        row.blockedAt === null
          ? null
          : {
              blockedAt: new Date(row.blockedAt).toISOString(),
              blockedBy: row.blockedByName ?? '',
              reason: row.blockReason ?? '',
            },
    };
  }

  async status(trx: Transaction<DB>, tenantId: string): Promise<string | null> {
    const row = await trx
      .selectFrom('tenants')
      .select('status')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    return row?.status ?? null;
  }

  // The store registry: the columns granted to pharmacy_platform (no address — tenant data).
  async stores(trx: Transaction<DB>, tenantId: string): Promise<StoreSummary[]> {
    const rows = await trx
      .selectFrom('stores')
      .select(['id', 'tenantId', 'name', 'mode', 'status', 'closedAt'])
      .where('tenantId', '=', tenantId)
      .orderBy('name')
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      address: '',
      mode: row.mode === 'online' ? 'cloud' : 'offline',
      status: row.status === 'closed' ? 'closed' : 'active',
      closedOn: row.closedAt === null ? null : dateOnly(row.closedAt),
      paidUntil: null,
      licenseValidUntil: null,
      lastSyncAt: null,
      monthSalesMinor: 0,
    }));
  }

  async provision(trx: Transaction<DB>, input: ProvisionInput): Promise<void> {
    await sql`select pharmacy.provision_tenant(
      ${input.tenantId}::uuid, ${input.code}, ${input.name}, ${input.city}, ${input.inn},
      ${input.ownerEmployeeId}::uuid, ${input.ownerRoleId}::uuid, ${JSON.stringify(input.ownerRoleName)}::jsonb,
      ${input.owner.fullName}, ${input.owner.login}, ${input.owner.phone}, ${input.owner.email},
      ${input.codeHash}, ${input.codeExpiresAt.toISOString()}::timestamptz,
      ${JSON.stringify(input.defaultRoles)}::jsonb
    )`.execute(trx);
  }

  /**
   * A new owner code; the network's own audit_log records who issued it (acting_operator_id), so
   * the owner sees it (ADR-0008, amendment 2026-10-05).
   */
  async issueOwnerCode(
    trx: Transaction<DB>,
    input: {
      tenantId: string;
      codeHash: string;
      expiresAt: Date;
      operatorId: string;
      auditId: string;
      correlationId: string;
    },
  ): Promise<boolean> {
    const { rows } = await sql<{ ok: boolean }>`select pharmacy.issue_owner_code(
      ${input.tenantId}::uuid, ${input.codeHash}, ${input.expiresAt.toISOString()}::timestamptz,
      ${input.operatorId}::uuid, ${input.auditId}::uuid, ${input.correlationId}
    ) as ok`.execute(trx);
    return rows[0]?.ok === true;
  }

  /** Blocks an active tenant; false when it is not active (or does not exist). */
  async block(
    trx: Transaction<DB>,
    tenantId: string,
    operatorId: string,
    reason: string,
  ): Promise<boolean> {
    const result = await trx
      .updateTable('tenants')
      .set({
        status: 'blocked',
        blockedAt: sql<Date>`now()`,
        blockedBy: operatorId,
        blockReason: reason,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', tenantId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Unblocks a blocked tenant; false when it is not blocked (or does not exist). */
  async unblock(trx: Transaction<DB>, tenantId: string): Promise<boolean> {
    const result = await trx
      .updateTable('tenants')
      .set({
        status: 'active',
        blockedAt: null,
        blockedBy: null,
        blockReason: null,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', tenantId)
      .where('status', '=', 'blocked')
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
