import { Injectable } from '@nestjs/common';
import {
  AUDIT_GROUP_RULES,
  type AuditGroup,
  type AuditGroupRule,
} from '@pharmacy/shared-domain';
import { type RawBuilder, sql, type SqlBool } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface AuditJournalFilter {
  /** YYYY-MM-DD, both days included, in the time zone of the network. */
  from: string;
  to: string;
  timezone: string;
  /** 'all' — every store and the entries without a store; a list — only these stores. */
  scope: 'all' | readonly string[];
  employeeId: string | null;
  storeId: string | null;
  group: AuditGroup | null;
  excludeGroups: readonly AuditGroup[];
  q: string | null;
  limit: number;
  offset: number;
}

export interface AuditJournalRow {
  id: string;
  recordedAt: Date;
  businessDate: string;
  action: string;
  details: Record<string, unknown>;
  actingOperatorId: string | null;
  employeeName: string | null;
  storeName: string | null;
  /** The number of the document or the name of the employee, store or supplier. */
  objectText: string | null;
  /** The language map of the product, category or role. */
  objectNames: unknown;
}

const likeEscaped = (value: string) => value.replace(/[\\%_]/g, '\\$&');

// One rule of a group as SQL (rules in libs/shared/domain): false, never NULL, so a NOT of it keeps
// the rows of no group.
function ruleSql(rule: AuditGroupRule): RawBuilder<SqlBool> {
  const named: RawBuilder<unknown>[] = [];
  if (rule.actions && rule.actions.length > 0) {
    named.push(sql`l.action = any(${sql.val([...rule.actions])}::text[])`);
  }
  for (const prefix of rule.prefixes ?? []) {
    named.push(sql`l.action like ${`${likeEscaped(prefix)}%`}`);
  }
  const action = sql`(${sql.join(named, sql` or `)})`;
  const typed = rule.documentTypes
    ? sql`(${action} and l.details ->> 'type' = any(${sql.val([...rule.documentTypes])}::text[]))`
    : action;
  return sql<SqlBool>`coalesce(${typed}, false)`;
}

function groupSql(group: AuditGroup): RawBuilder<SqlBool> {
  const rules = AUDIT_GROUP_RULES.filter((rule) => rule.group === group);
  return sql<SqlBool>`(${sql.join(rules.map(ruleSql), sql` or `)})`;
}

// The tenant audit journal (spec 2026-10-14-owner-cabinet, E7, 5.5): audit_log of the network with
// the names of the employee, the store and the object for the screen. Reference tables are joined
// for names only.
@Injectable()
export class AuditJournalRepository {
  /** Today and the time zone of the network. */
  async calendar(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<{ today: string; timezone: string }> {
    const result = await sql<{ today: string; timezone: string }>`
      select (now() at time zone coalesce(ts.timezone, 'Asia/Dushanbe'))::date::text as today,
             coalesce(ts.timezone, 'Asia/Dushanbe') as timezone
      from (select 1) one
      left join pharmacy.tenant_settings ts on ts.tenant_id = ${tenantId}`.execute(
      trx,
    );
    return result.rows[0];
  }

  async list(
    trx: TenantTransaction,
    tenantId: string,
    filter: AuditJournalFilter,
  ): Promise<{ rows: AuditJournalRow[]; total: number }> {
    const from = sql`
      from pharmacy.audit_log l
      left join pharmacy.employees e
        on e.tenant_id = l.tenant_id and e.id = l.employee_id
      left join pharmacy.stores s
        on s.tenant_id = l.tenant_id and s.id = l.store_id
      left join pharmacy.employees ee
        on l.entity_type = 'employee' and ee.tenant_id = l.tenant_id and ee.id = l.entity_id
      left join pharmacy.stores es
        on l.entity_type = 'store' and es.tenant_id = l.tenant_id and es.id = l.entity_id
      left join pharmacy.suppliers sup
        on l.entity_type = 'supplier' and sup.tenant_id = l.tenant_id and sup.id = l.entity_id
      left join pharmacy.products p
        on l.entity_type = 'product' and p.tenant_id = l.tenant_id and p.id = l.entity_id
      left join pharmacy.categories c
        on l.entity_type = 'category' and c.tenant_id = l.tenant_id and c.id = l.entity_id
      left join pharmacy.roles r
        on l.entity_type = 'role' and r.tenant_id = l.tenant_id and r.id = l.entity_id
      left join pharmacy.services sv
        on l.entity_type = 'service_request' and sv.id::text = l.details ->> 'serviceId'
      where l.tenant_id = ${tenantId} and ${this.conditions(filter)}`;
    const count = await sql<{
      total: string;
    }>`select count(*) as total ${from}`.execute(trx);
    const rows = await sql<AuditJournalRow>`
      select l.id, l.recorded_at, l.business_date::text as business_date, l.action, l.details,
             l.acting_operator_id, e.full_name as employee_name, s.name as store_name,
             coalesce(l.details ->> 'number', ee.full_name, es.name, sup.name) as object_text,
             coalesce(p.name, c.name, r.name, sv.name) as object_names
      ${from}
      order by l.recorded_at desc, l.id desc
      limit ${filter.limit} offset ${filter.offset}`.execute(trx);
    return { rows: rows.rows, total: Number(count.rows[0].total) };
  }

  private conditions(filter: AuditJournalFilter): RawBuilder<SqlBool> {
    const parts: RawBuilder<unknown>[] = [
      // calendar days of the network, both ends included
      sql`l.recorded_at >= ((${filter.from}::date)::timestamp at time zone ${filter.timezone})`,
      sql`l.recorded_at < ((${filter.to}::date + 1)::timestamp at time zone ${filter.timezone})`,
    ];
    if (filter.scope !== 'all') {
      parts.push(sql`l.store_id = any(${sql.val([...filter.scope])}::uuid[])`);
    }
    if (filter.employeeId)
      parts.push(sql`l.employee_id = ${filter.employeeId}`);
    if (filter.storeId) parts.push(sql`l.store_id = ${filter.storeId}`);
    if (filter.group) parts.push(groupSql(filter.group));
    for (const group of filter.excludeGroups) {
      parts.push(sql`not ${groupSql(group)}`);
    }
    if (filter.q) {
      const pattern = `%${likeEscaped(filter.q)}%`;
      parts.push(sql`(
        l.details ->> 'number' ilike ${pattern} or ee.full_name ilike ${pattern}
        or es.name ilike ${pattern} or sup.name ilike ${pattern}
        or p.name::text ilike ${pattern} or c.name::text ilike ${pattern}
        or sv.name::text ilike ${pattern})`);
    }
    return sql<SqlBool>`${sql.join(parts, sql` and `)}`;
  }
}
