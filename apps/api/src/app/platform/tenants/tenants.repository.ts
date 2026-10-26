import { Injectable } from '@nestjs/common';
import type {
  StoreSummary,
  TenantDetails,
  TenantListFilter,
  TenantListItem,
  TenantSortKey,
} from '@pharmacy/shared-dto';
import { type Expression, type SqlBool, sql, type Transaction } from 'kysely';
import {
  type DB,
  escapeLike,
  PLATFORM_TIME_ZONE,
  platformDate,
  platformToday,
} from '../../../core/database';

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
  /** Starter categories and dosage forms (spec 2026-10-07-catalog-pricing, section 4). */
  catalogDefaults: {
    categories: ReadonlyArray<{ id: string; name: { ru: string; tj: string } }>;
    dosageForms: ReadonlyArray<{ id: string; code: string; name: { ru: string; tj: string } }>;
  };
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
  debtDirams: number | string | bigint;
  overdueDirams: number | string | bigint;
  billingAdvanceDirams: number | string | bigint;
  discountBp: number | null;
  discountTo: string | null;
};

// Billing of a network (spec 2026-10-15-billing-services, 5, 6.1; B12): the debt is what its
// invoices still miss, the overdue debt — of the invoices past their due date (the calendar of the platform); the
// discount is the one of the current month.
const TODAY = platformToday();
const CURRENT_MONTH = sql`date_trunc('month', now() at time zone ${sql.lit(PLATFORM_TIME_ZONE)})::date`;
const DEBT = sql<string>`(select coalesce(sum(i.total_dirams - i.paid_dirams), 0)
  from pharmacy.invoices i where i.tenant_id = tenants.id)`;
const OVERDUE_DEBT = sql<string>`(select coalesce(sum(i.total_dirams - i.paid_dirams), 0)
  from pharmacy.invoices i where i.tenant_id = tenants.id and i.due_on < ${TODAY})`;
const HAS_OVERDUE = sql<SqlBool>`exists (select 1 from pharmacy.invoices i
  where i.tenant_id = tenants.id and i.paid_dirams < i.total_dirams and i.due_on < ${TODAY})`;
const CURRENT_DISCOUNT = sql`from pharmacy.tenant_discounts d
  where d.tenant_id = tenants.id and d.removed_at is null
    and d.from_month <= ${CURRENT_MONTH} and d.to_month >= ${CURRENT_MONTH}`;

// `%`, `_` and the escape character itself are literal in a search term.
function likePattern(q: string): string {
  return `%${escapeLike(q)}%`;
}

const dateOnly = (value: Date | string): string =>
  new Date(value).toISOString().slice(0, 10);

interface StoreRegistryRow {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  mode: string;
  status: string;
  /** The day of the platform (Asia/Dushanbe) the store closed. */
  closedOn: string | null;
}

// The registry columns only (ADR-0013 §5; the address — amendment 2026-10-23); the month comes from the marts (the
// service), the offline figures with the offline part of the admin.
function toStoreSummary(row: StoreRegistryRow): StoreSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    address: row.address,
    mode: row.mode === 'online' ? 'cloud' : 'offline',
    status: row.status === 'closed' ? 'closed' : 'active',
    closedOn: row.closedOn,
    licenseValidUntil: null,
    lastSyncAt: null,
    monthSalesMinor: 0,
  };
}

// The registry columns of a store with its days in the time zone of the platform (a store created at 02:00 in
// Dushanbe is created that day, not the day before in UTC).
const STORE_CLOSED_ON = sql<string | null>`${platformDate(sql.ref('stores.closed_at'))}::text`;
const STORE_CREATED_ON = sql<string>`${platformDate(sql.ref('stores.created_at'))}::text`;

export interface StoreCardRow {
  summary: StoreSummary;
  tenantName: string;
  /** Date-only. */
  connectedOn: string;
}

function toListItem(row: TenantRow): TenantListItem {
  const overdueDebtMinor = Number(row.overdueDirams);
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
    overdue: overdueDebtMinor > 0,
    cloudStores: Number(row.cloudStores),
    offlineStores: Number(row.offlineStores),
    debtMinor: Number(row.debtDirams),
    overdueDebtMinor,
    advanceMinor: Number(row.billingAdvanceDirams),
    discount:
      row.discountBp === null || row.discountTo === null
        ? null
        : { percentBp: row.discountBp, toMonth: row.discountTo },
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
        'tenants.billingAdvanceDirams',
        DEBT.as('debtDirams'),
        OVERDUE_DEBT.as('overdueDirams'),
        sql<number | null>`(select d.percent_bp ${CURRENT_DISCOUNT})`.as('discountBp'),
        sql<string | null>`(select to_char(d.to_month, 'YYYY-MM') ${CURRENT_DISCOUNT})`.as(
          'discountTo',
        ),
        eb
          .selectFrom('stores')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('stores.tenantId', '=', 'tenants.id')
          // a closing store still works with its license (spec 2026-10-15-store-closing, 4)
          .where('stores.status', 'in', ['active', 'closing'])
          .where('stores.mode', '=', 'online')
          .as('cloudStores'),
        eb
          .selectFrom('stores')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('stores.tenantId', '=', 'tenants.id')
          .where('stores.status', 'in', ['active', 'closing'])
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

    // Counts per filter over the same search; `unpaid` — networks with an overdue debt.
    let countQuery = trx
      .selectFrom('tenants')
      .select([
        sql<string>`count(*)`.as('all'),
        sql<string>`count(*) filter (where status = 'active')`.as('active'),
        sql<string>`count(*) filter (where status = 'blocked')`.as('blocked'),
        sql<string>`count(*) filter (where ${HAS_OVERDUE})`.as('unpaid'),
      ]);
    if (params.q) countQuery = countQuery.where(this.search(params.q));
    const countRow = await countQuery.executeTakeFirstOrThrow();
    const counts: Record<TenantListFilter, number> = {
      all: Number(countRow.all),
      active: Number(countRow.active),
      blocked: Number(countRow.blocked),
      unpaid: Number(countRow.unpaid),
    };

    if (params.filter === 'active' || params.filter === 'blocked') {
      query = query.where('tenants.status', '=', params.filter);
    } else if (params.filter === 'unpaid') {
      query = query.where(HAS_OVERDUE);
    }
    const total = counts[params.filter];

    const direction = params.direction;
    const ordered =
      params.sort === 'debt'
        ? query.orderBy(DEBT, direction).orderBy('tenants.name')
        : params.sort === 'owner'
        ? query.orderBy('tenants.ownerFullName', direction)
        : params.sort === 'stores'
          ? query.orderBy(
              sql`(select count(*) from pharmacy.stores s where s.tenant_id = tenants.id and s.status in ('active', 'closing'))`,
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

  // The store registry: the columns granted to pharmacy_platform.
  async stores(trx: Transaction<DB>, tenantId: string): Promise<StoreSummary[]> {
    const rows = await trx
      .selectFrom('stores')
      .select([
        'id',
        'tenantId',
        'name',
        'address',
        'mode',
        'status',
        STORE_CLOSED_ON.as('closedOn'),
      ])
      .where('tenantId', '=', tenantId)
      .orderBy('name')
      .orderBy('id')
      .execute();
    return rows.map(toStoreSummary);
  }

  /** A store of the registry with the name of its network; null — no such store. */
  async storeCard(trx: Transaction<DB>, storeId: string): Promise<StoreCardRow | null> {
    const row = await trx
      .selectFrom('stores')
      .innerJoin('tenants', 'tenants.id', 'stores.tenantId')
      .select([
        'stores.id',
        'stores.tenantId',
        'stores.name',
        'stores.address',
        'stores.mode',
        'stores.status',
        STORE_CLOSED_ON.as('closedOn'),
        STORE_CREATED_ON.as('connectedOn'),
        'tenants.name as tenantName',
      ])
      .where('stores.id', '=', storeId)
      .executeTakeFirst();
    return row === undefined
      ? null
      : {
          summary: toStoreSummary(row),
          tenantName: row.tenantName,
          connectedOn: row.connectedOn,
        };
  }

  async provision(trx: Transaction<DB>, input: ProvisionInput): Promise<void> {
    await sql`select pharmacy.provision_tenant(
      ${input.tenantId}::uuid, ${input.code}, ${input.name}, ${input.city}, ${input.inn},
      ${input.ownerEmployeeId}::uuid, ${input.ownerRoleId}::uuid, ${JSON.stringify(input.ownerRoleName)}::jsonb,
      ${input.owner.fullName}, ${input.owner.login}, ${input.owner.phone}, ${input.owner.email},
      ${input.codeHash}, ${input.codeExpiresAt.toISOString()}::timestamptz,
      ${JSON.stringify(input.defaultRoles)}::jsonb,
      ${JSON.stringify(input.catalogDefaults)}::jsonb
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

  /** The name, city and INN of a network; null — no such network (spec 2026-10-26-pilot-small-gaps, P9). */
  async requisites(
    trx: Transaction<DB>,
    tenantId: string,
  ): Promise<{ name: string; city: string; inn: string } | null> {
    const row = await trx
      .selectFrom('tenants')
      .select(['name', 'city', 'billingTaxId'])
      .where('id', '=', tenantId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    return row
      ? { name: row.name, city: row.city, inn: row.billingTaxId ?? '' }
      : null;
  }

  async updateRequisites(
    trx: Transaction<DB>,
    tenantId: string,
    next: { name: string; city: string; inn: string },
  ): Promise<void> {
    await trx
      .updateTable('tenants')
      .set({
        name: next.name,
        city: next.city,
        billingTaxId: next.inn,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', tenantId)
      .execute();
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
