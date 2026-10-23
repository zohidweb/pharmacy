import { Injectable } from '@nestjs/common';
import type {
  OperatorActionType,
  OperatorAuditEntry,
  OperatorAuditRef,
} from '@pharmacy/shared-dto';
import { type RawBuilder, sql, type SqlBool, type Transaction } from 'kysely';
import { type DB, PLATFORM_TIME_ZONE } from '../../../core/database';

/**
 * Kinds of events by the prefix of the code. An event of none of them — sign-ins, activation,
 * refusals, the team (`auth.`, `operator.`, `access.`) — is of kind `access`.
 */
const KIND_PREFIXES: Record<Exclude<OperatorActionType, 'access'>, readonly string[]> = {
  company: ['tenant.'],
  payment: ['payment.', 'invoice.'],
  key: ['license.'],
  service: ['service.'],
  settings: ['settings.', 'announcement.'],
};

/** Details operators see: codes only — never IP addresses, routes or free text. */
const SHOWN_DETAILS = ['permission', 'reason', 'created'] as const;
/** A code, not prose: a value of another shape (a name, a phone) stays in the database. */
const CODE = /^[a-z0-9_.:-]{1,64}$/;

export interface OperatorAuditFilter {
  operatorId: string | null;
  /** `operatorId` as the actor only — «Мои последние действия»; else also what was done to them. */
  actorOnly?: boolean;
  tenantId: string | null;
  type: OperatorActionType | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}

export function actionType(action: string): OperatorActionType {
  for (const [kind, prefixes] of Object.entries(KIND_PREFIXES)) {
    if (prefixes.some((prefix) => action.startsWith(prefix))) {
      return kind as OperatorActionType;
    }
  }
  return 'access';
}

const startsWithAny = (prefixes: readonly string[]) =>
  sql<SqlBool>`(${sql.join(
    prefixes.map((prefix) => sql`l.action like ${`${prefix}%`}`),
    sql` or `,
  )})`;

function shownDetails(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const details = value as Record<string, unknown>;
  const shown: Record<string, string> = {};
  for (const key of SHOWN_DETAILS) {
    const item = details[key];
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const value = String(item);
      if (CODE.test(value)) shown[key] = value;
    }
  }
  return shown;
}

const ref = (id: string | null, name: string | null): OperatorAuditRef | null =>
  id === null ? null : { id, name: name ?? '' };

// The operators' audit log for the operator contour (data model 06, platform_audit_log): read
// only, newest first. Names come from the registries the platform role reads (operators, tenants,
// the store registry columns).
@Injectable()
export class OperatorAuditRepository {
  async list(
    trx: Transaction<DB>,
    filter: OperatorAuditFilter,
  ): Promise<{ items: OperatorAuditEntry[]; total: number }> {
    const count = await trx
      .selectFrom('platformAuditLog as l')
      .select(sql<string>`count(*)`.as('total'))
      .where(this.conditions(filter))
      .executeTakeFirstOrThrow();
    const items = await this.entries(trx, filter);
    return { items, total: Number(count.total) };
  }

  /** One page of the filtered log, newest first, without the total. */
  async entries(
    trx: Transaction<DB>,
    filter: OperatorAuditFilter,
  ): Promise<OperatorAuditEntry[]> {
    const where = this.conditions(filter);
    const rows = await trx
      .selectFrom('platformAuditLog as l')
      .leftJoin('operators as actor', 'actor.id', 'l.operatorId')
      .leftJoin('tenants as t', 't.id', 'l.tenantId')
      .leftJoin('stores as s', (join) =>
        join.onRef('s.id', '=', 'l.entityId').on('l.entityType', '=', 'store'),
      )
      .leftJoin('operators as subject', (join) =>
        join.onRef('subject.id', '=', 'l.entityId').on('l.entityType', '=', 'operator'),
      )
      .select([
        'l.id',
        'l.recordedAt',
        'l.actorKind',
        'l.operatorId',
        'l.job',
        'l.action',
        'l.details',
        'l.tenantId',
        'actor.fullName as actorName',
        't.name as tenantName',
        's.id as storeId',
        's.name as storeName',
        'subject.id as subjectId',
        'subject.fullName as subjectName',
      ])
      .where(where)
      .orderBy('l.recordedAt', 'desc')
      .orderBy('l.id', 'desc')
      .limit(filter.limit)
      .offset(filter.offset)
      .execute();

    return rows.map(
      (row): OperatorAuditEntry => ({
        id: row.id,
        at: new Date(row.recordedAt).toISOString(),
        actor:
          row.actorKind === 'system'
            ? { kind: 'system', job: row.job ?? '' }
            : { kind: 'operator', operatorId: row.operatorId ?? '', name: row.actorName ?? '' },
        type: actionType(row.action),
        action: row.action,
        tenant: ref(row.tenantId, row.tenantName),
        store: ref(row.storeId, row.storeName),
        operator: ref(row.subjectId, row.subjectName),
        details: shownDetails(row.details),
      }),
    );
  }

  private conditions(filter: OperatorAuditFilter): RawBuilder<SqlBool> {
    const parts: RawBuilder<unknown>[] = [sql`true`];
    // everything about the operator: what they did and what was done to their account — a failed
    // sign-in is recorded by the operator-auth job with the operator as its entity (auth3-M3)
    if (filter.operatorId && filter.actorOnly) {
      parts.push(sql`l.operator_id = ${filter.operatorId}`);
    } else if (filter.operatorId) {
      parts.push(
        sql`(l.operator_id = ${filter.operatorId}
             or (l.entity_type = 'operator' and l.entity_id = ${filter.operatorId}))`,
      );
    }
    if (filter.tenantId) parts.push(sql`l.tenant_id = ${filter.tenantId}`);
    if (filter.type === 'access') {
      parts.push(sql`not ${startsWithAny(Object.values(KIND_PREFIXES).flat())}`);
    } else if (filter.type) {
      parts.push(startsWithAny(KIND_PREFIXES[filter.type]));
    }
    // Calendar days of the platform, both ends included.
    if (filter.from) {
      parts.push(
        sql`l.recorded_at >= ((${filter.from}::date)::timestamp at time zone ${PLATFORM_TIME_ZONE})`,
      );
    }
    if (filter.to) {
      parts.push(
        sql`l.recorded_at < ((${filter.to}::date + 1)::timestamp at time zone ${PLATFORM_TIME_ZONE})`,
      );
    }
    return sql<SqlBool>`${sql.join(parts, sql` and `)}`;
  }
}
