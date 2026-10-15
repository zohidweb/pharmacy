import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** A text of a `{ru, tj}` map; null when the language is absent. */
export function textOf(map: unknown, key: 'ru' | 'tj'): string | null {
  if (map === null || typeof map !== 'object') return null;
  const value = (map as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export interface CatalogRow {
  id: string;
  name: unknown;
  description: unknown;
  basePriceDirams: string | number | bigint;
}

export interface OrderRow {
  requestId: string | null;
  serviceId: string;
  name: unknown;
  comment: string | null;
  requestedAt: Date | null;
  status: string | null;
  priceDirams: string | number | bigint | null;
  reason: string | null;
  providedOn: string | null;
  decidedAt: Date | null;
}

export interface DecisionRow {
  id: string;
  name: unknown;
  status: 'approved' | 'rejected' | 'cancelled';
  priceDirams: string | number | bigint | null;
  reason: string | null;
  decidedAt: Date;
}

// The network's side of the services (spec 2026-10-15-billing-services, A12, 6.2), in the tenant
// transaction (pharmacy_app, RLS): the catalog (shared), its own requests (tenant-export, DML) and
// the operator's decisions on them (platform, own rows read only).
@Injectable()
export class OwnerServicesRepository {
  /** Visible, not archived services, by the Russian name. */
  async catalog(trx: TenantTransaction): Promise<CatalogRow[]> {
    return trx
      .selectFrom('services')
      .select(['id', 'name', 'description', 'basePriceDirams'])
      .where('visible', '=', true)
      .where('archived', '=', false)
      .orderBy(sql`lower(name ->> 'ru')`)
      .orderBy('id')
      .execute();
  }

  /** The requests with their decision and the services added without a request, newest first. */
  async orders(trx: TenantTransaction, tenantId: string): Promise<OrderRow[]> {
    const { rows } = await sql<OrderRow>`
      select r.id as "requestId", r.service_id as "serviceId", s.name, r.comment,
             r.requested_at as "requestedAt", ts.status, ts.price_dirams as "priceDirams",
             ts.reason, ts.provided_on::text as "providedOn", ts.decided_at as "decidedAt"
      from pharmacy.service_requests r
      join pharmacy.services s on s.id = r.service_id
      left join pharmacy.tenant_services ts on ts.tenant_id = r.tenant_id and ts.request_id = r.id
      where r.tenant_id = ${tenantId}
      union all
      select null, ts.service_id, s.name, null, null, ts.status, ts.price_dirams, ts.reason,
             ts.provided_on::text, ts.decided_at
      from pharmacy.tenant_services ts
      join pharmacy.services s on s.id = ts.service_id
      where ts.tenant_id = ${tenantId} and ts.request_id is null
      order by 5 desc nulls last, 10 desc nulls last`.execute(trx);
    return rows;
  }

  /** The visibility of a service for a request, or null for an unknown one. */
  async offered(
    trx: TenantTransaction,
    serviceId: string,
  ): Promise<boolean | null> {
    const row = await trx
      .selectFrom('services')
      .select(['visible', 'archived'])
      .where('id', '=', serviceId)
      .executeTakeFirst();
    return row ? row.visible && !row.archived : null;
  }

  /** Serializes the requests of one network for one service (the «one pending request» rule). */
  async lockService(
    trx: TenantTransaction,
    tenantId: string,
    serviceId: string,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext(${`service-request:${tenantId}:${serviceId}`}))`.execute(
      trx,
    );
  }

  async pendingExists(
    trx: TenantTransaction,
    tenantId: string,
    serviceId: string,
  ): Promise<boolean> {
    const { rows } = await sql<{ found: boolean }>`
      select exists (
        select 1 from pharmacy.service_requests r
        where r.tenant_id = ${tenantId} and r.service_id = ${serviceId}
          and not exists (select 1 from pharmacy.tenant_services ts
                          where ts.tenant_id = r.tenant_id and ts.request_id = r.id)) as found`.execute(
      trx,
    );
    return rows[0]?.found ?? false;
  }

  async insertRequest(
    trx: TenantTransaction,
    request: {
      tenantId: string;
      id: string;
      serviceId: string;
      comment: string | null;
      requestedBy: string;
    },
  ): Promise<void> {
    await trx.insertInto('serviceRequests').values(request).execute();
  }

  /** `pending` / `decided` for a request of the network, null for an unknown one. */
  async requestState(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<'pending' | 'decided' | null> {
    const { rows } = await sql<{ decided: boolean }>`
      select exists (select 1 from pharmacy.tenant_services ts
                     where ts.tenant_id = r.tenant_id and ts.request_id = r.id) as decided
      from pharmacy.service_requests r
      where r.tenant_id = ${tenantId} and r.id = ${id}`.execute(trx);
    if (rows.length === 0) return null;
    return rows[0].decided ? 'decided' : 'pending';
  }

  /** The service of the deleted request, for the journal; null when no row was deleted. */
  async deleteRequest(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<string | null> {
    const row = await trx
      .deleteFrom('serviceRequests')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .returning('serviceId')
      .executeTakeFirst();
    return row?.serviceId ?? null;
  }

  /**
   * Decisions since an instant: an approval or a rejection by its decision time, a cancellation by
   * its change time. A provided service reports its approval.
   */
  async decidedSince(
    trx: TenantTransaction,
    tenantId: string,
    since: Date,
  ): Promise<DecisionRow[]> {
    const { rows } = await sql<DecisionRow>`
      select ts.id, s.name,
             case when ts.status = 'provided' then 'approved' else ts.status end as status,
             ts.price_dirams as "priceDirams", ts.reason,
             case when ts.status = 'cancelled' then ts.updated_at else ts.decided_at end as "decidedAt"
      from pharmacy.tenant_services ts
      join pharmacy.services s on s.id = ts.service_id
      where ts.tenant_id = ${tenantId}
        and ((ts.status <> 'cancelled' and ts.decided_at >= ${since})
             or (ts.status = 'cancelled' and ts.updated_at >= ${since}))
      order by 6`.execute(trx);
    return rows;
  }
}
