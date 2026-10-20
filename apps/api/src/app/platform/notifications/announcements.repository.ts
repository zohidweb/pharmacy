import { Injectable } from '@nestjs/common';
import type { Announcement, AnnouncementScope } from '@pharmacy/shared-dto';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

export interface AnnouncementRow {
  id: string;
  title: string;
  text: string;
  startsAt: Date;
  endsAt: Date;
  scope: AnnouncementScope;
  cancelledAt: Date | null;
  started: boolean;
  ended: boolean;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

export function announcementOf(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    scope: row.scope,
    status:
      row.cancelledAt !== null
        ? 'cancelled'
        : row.started
          ? 'published'
          : 'scheduled',
  };
}

const COLUMNS = sql`a.id, a.title, a.text, a.starts_at, a.ends_at, a.scope, a.cancelled_at,
  a.starts_at <= now() as started, a.ends_at <= now() as ended`;

// Announcements to networks (spec 2026-10-19-operator-notifications, N11–N13; table announcements —
// shared), written by the operators in the platform transaction of the caller. Rows are never deleted:
// a cancelled one carries cancelled_at.
@Injectable()
export class AnnouncementsRepository {
  /** Not cancelled and not ended, by the start. */
  async current(trx: Transaction<DB>): Promise<Announcement[]> {
    const { rows } = await sql<AnnouncementRow>`
      select ${COLUMNS} from pharmacy.announcements a
      where a.cancelled_at is null and a.ends_at > now()
      order by a.starts_at, a.id`.execute(trx);
    return rows.map(announcementOf);
  }

  async insert(
    trx: Transaction<DB>,
    values: {
      id: string;
      title: string;
      text: string;
      startsAt: string;
      endsAt: string;
      scope: AnnouncementScope;
      createdBy: string;
    },
  ): Promise<Announcement> {
    const { rows } = await sql<AnnouncementRow>`
      insert into pharmacy.announcements as a
        (id, title, text, starts_at, ends_at, scope, created_by)
      values (${values.id}, ${values.title}, ${values.text}, ${values.startsAt}::timestamptz,
              ${values.endsAt}::timestamptz, ${values.scope}, ${values.createdBy})
      returning ${COLUMNS}`.execute(trx);
    return announcementOf(rows[0]);
  }

  /** The row under FOR NO KEY UPDATE, so two cancellations go one after another. */
  async lock(
    trx: Transaction<DB>,
    id: string,
  ): Promise<AnnouncementRow | null> {
    const { rows } = await sql<AnnouncementRow>`
      select ${COLUMNS} from pharmacy.announcements a
      where a.id = ${id} for no key update`.execute(trx);
    return rows[0] ?? null;
  }

  async cancel(
    trx: Transaction<DB>,
    id: string,
    operatorId: string,
  ): Promise<Announcement> {
    const { rows } = await sql<AnnouncementRow>`
      update pharmacy.announcements as a
      set cancelled_at = now(), cancelled_by = ${operatorId}
      where a.id = ${id}
      returning ${COLUMNS}`.execute(trx);
    return announcementOf(rows[0]);
  }
}
