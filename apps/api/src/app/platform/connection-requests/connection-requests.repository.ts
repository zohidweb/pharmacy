import { Injectable } from '@nestjs/common';
import type {
  ConnectionRequestListItem,
  ConnectionRequestStatus,
  UiLocale,
} from '@pharmacy/shared-dto';
import {
  type Insertable,
  sql,
  type Transaction,
  type Updateable,
} from 'kysely';
import { type DB, escapeLike } from '../../../core/database';

type ConnectionRequests = DB['connectionRequests'];

const DAY = sql`interval '24 hours'`;
// The term of the personal data of a declined request (spec 2026-10-28-public-site-design, 7.4; P7).
const RETENTION = sql`interval '180 days'`;

/** A request with the comment and the note of the operator: the card without the similar networks. */
export type ConnectionRequestRow = ConnectionRequestListItem & {
  comment: string | null;
  operatorNote: string | null;
};

/** What a decision of the operator needs of a locked request. */
export interface ConnectionRequestState {
  status: ConnectionRequestStatus;
  assignedTo: string | null;
  anonymized: boolean;
}

export interface ConnectionRequestFilter {
  statuses: readonly ConnectionRequestStatus[];
  /** A part of the network name. */
  name: string | null;
  /** Digits of the phone, when the search looks like a phone. */
  phoneDigits: string | null;
}

const iso = (value: Date | string): string => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value);

// The connection requests of the public site (spec 2026-10-28-public-site-design, 7.1). A platform class table: the
// platform path only, rows are never deleted — the personal data of a declined request is set to null by the term.
@Injectable()
export class ConnectionRequestsRepository {
  async insert(
    trx: Transaction<DB>,
    row: Insertable<ConnectionRequests>,
  ): Promise<void> {
    await trx.insertInto('connectionRequests').values(row).execute();
  }

  /** An open request with this phone sent within the last 24 hours. */
  async hasOpenWithPhone(
    trx: Transaction<DB>,
    phone: string,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom('connectionRequests')
      .select('id')
      .where('phone', '=', phone)
      .where('status', 'in', ['new', 'in_progress'])
      .where('createdAt', '>', sql<Date>`now() - ${DAY}`)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** The requests that are not spam created within the last 24 hours (the daily cap of the form). */
  async countRecentNotSpam(trx: Transaction<DB>): Promise<number> {
    const row = await trx
      .selectFrom('connectionRequests')
      .select(sql<string>`count(*)`.as('n'))
      .where('status', '<>', 'spam')
      .where('createdAt', '>', sql<Date>`now() - ${DAY}`)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  private base(trx: Transaction<DB>) {
    return trx
      .selectFrom('connectionRequests as r')
      .leftJoin('operators as o', 'o.id', 'r.assignedTo');
  }

  private filtered(trx: Transaction<DB>, filter: ConnectionRequestFilter) {
    let query = this.base(trx).where('r.status', 'in', [...filter.statuses]);
    const { name, phoneDigits } = filter;
    if (name !== null) {
      const namePattern = `%${escapeLike(name)}%`;
      query = query.where((eb) =>
        eb.or([
          eb('r.networkName', 'ilike', namePattern),
          ...(phoneDigits === null
            ? []
            : [eb('r.phone', 'like', `%${escapeLike(phoneDigits)}%`)]),
        ]),
      );
    }
    return query;
  }

  /** The newest first. */
  async list(
    trx: Transaction<DB>,
    filter: ConnectionRequestFilter,
    limit: number,
    offset: number,
  ): Promise<{ items: ConnectionRequestListItem[]; total: number }> {
    const rows = await this.filtered(trx, filter)
      .select(LIST_COLUMNS)
      .orderBy('r.createdAt', 'desc')
      .orderBy('r.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
    const counted = await this.filtered(trx, filter)
      .select(sql<string>`count(*)`.as('n'))
      .executeTakeFirstOrThrow();
    return { items: rows.map(toListItem), total: Number(counted.n) };
  }

  async card(
    trx: Transaction<DB>,
    id: string,
  ): Promise<ConnectionRequestRow | null> {
    const row = await this.base(trx)
      .select([...LIST_COLUMNS, 'r.comment', 'r.operatorNote'])
      .where('r.id', '=', id)
      .executeTakeFirst();
    if (row === undefined) return null;
    return {
      ...toListItem(row),
      comment: row.comment,
      operatorNote: row.operatorNote,
    };
  }

  /** Locks the request for a decision; null when there is none. */
  async lock(
    trx: Transaction<DB>,
    id: string,
  ): Promise<ConnectionRequestState | null> {
    const row = await trx
      .selectFrom('connectionRequests')
      .select(['status', 'assignedTo', 'anonymizedAt'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) return null;
    return {
      status: row.status as ConnectionRequestStatus,
      assignedTo: row.assignedTo,
      anonymized: row.anonymizedAt !== null,
    };
  }

  async update(
    trx: Transaction<DB>,
    id: string,
    patch: Updateable<ConnectionRequests>,
  ): Promise<void> {
    await trx
      .updateTable('connectionRequests')
      .set(patch)
      .where('id', '=', id)
      .execute();
  }

  /** The requests nobody has taken yet (the counter of «Заявки»). */
  async countNew(trx: Transaction<DB>): Promise<number> {
    const row = await trx
      .selectFrom('connectionRequests')
      .select(sql<string>`count(*)`.as('n'))
      .where('status', '=', 'new')
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** The requests nobody has taken yet, the oldest first (the notification state). */
  newRequests(
    trx: Transaction<DB>,
  ): Promise<{ id: string; networkName: string }[]> {
    return trx
      .selectFrom('connectionRequests')
      .select(['id', 'networkName'])
      .where('status', '=', 'new')
      .orderBy('createdAt')
      .orderBy('id')
      .execute();
  }

  /**
   * The personal data of the requests declined 180 days ago — `rejected` by the decision, `spam` by the decision or,
   * for the spam of the form, by the creation — is set to null; the decision and the reason stay. The count.
   */
  async anonymizeExpired(trx: Transaction<DB>): Promise<number> {
    const result = await trx
      .updateTable('connectionRequests')
      .set({
        contactName: null,
        phone: null,
        email: null,
        callTime: null,
        comment: null,
        clientIp: null,
        operatorNote: null,
        anonymizedAt: sql<Date>`now()`,
      })
      .where('anonymizedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb.and([
            eb('status', '=', 'rejected'),
            eb('decidedAt', '<', sql<Date>`now() - ${RETENTION}`),
          ]),
          eb.and([
            eb('status', '=', 'spam'),
            eb(
              sql<Date>`coalesce(decided_at, created_at)`,
              '<',
              sql<Date>`now() - ${RETENTION}`,
            ),
          ]),
        ]),
      )
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}

const LIST_COLUMNS = [
  'r.id',
  'r.status',
  'r.networkName',
  'r.city',
  'r.storeCount',
  'r.contactName',
  'r.phone',
  'r.email',
  'r.inn',
  'r.callTime',
  'r.locale',
  'r.privacyDocumentId',
  'r.createdAt',
  'r.assignedTo',
  'o.fullName as assignedName',
  'r.rejectReason',
  'r.tenantId',
  'r.decidedAt',
  'r.anonymizedAt',
] as const;

interface ListRow {
  id: string;
  status: string;
  networkName: string;
  city: string;
  storeCount: number;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  inn: string | null;
  callTime: string | null;
  locale: string;
  privacyDocumentId: string;
  createdAt: Date | string;
  assignedTo: string | null;
  assignedName: string | null;
  rejectReason: string | null;
  tenantId: string | null;
  decidedAt: Date | string | null;
  anonymizedAt: Date | string | null;
}

function toListItem(row: ListRow): ConnectionRequestListItem {
  return {
    id: row.id,
    status: row.status as ConnectionRequestStatus,
    networkName: row.networkName,
    city: row.city,
    storeCount: row.storeCount,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    inn: row.inn,
    callTime: row.callTime,
    locale: row.locale as UiLocale,
    privacyDocumentId: row.privacyDocumentId,
    createdAt: iso(row.createdAt),
    assignedTo:
      row.assignedTo === null
        ? null
        : { id: row.assignedTo, fullName: row.assignedName ?? '' },
    rejectReason: row.rejectReason,
    tenantId: row.tenantId,
    decidedAt: isoOrNull(row.decidedAt),
    anonymizedAt: isoOrNull(row.anonymizedAt),
  };
}
