import { Injectable } from '@nestjs/common';
import type {
  ServiceRequestItem,
  TenantServiceItem,
  TenantServiceStatus,
} from '@pharmacy/shared-dto';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';
import { textOf } from './billing.repository';

export interface RequestRow {
  id: string;
  tenantId: string;
  serviceId: string;
}

export interface DecisionValues {
  id: string;
  tenantId: string;
  serviceId: string;
  requestId: string | null;
  priceMinor: number | null;
  status: 'approved' | 'rejected';
  reason: string | null;
  decidedBy: string;
  /** The hash of the request that added a service without an order (B17). */
  requestHash?: Buffer | null;
}

export interface TenantServiceFilter {
  id?: string;
  tenantId?: string;
  status?: TenantServiceStatus;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

// Requests of networks and the operator's decisions (spec 2026-10-15-billing-services, A12, A13),
// in the caller's platform transaction. The platform reads service_requests (tenant-export) and
// writes tenant_services; a request is pending while no tenant_services row names it.
@Injectable()
export class ServiceOrdersRepository {
  /** The requests without a decision, oldest first. */
  async pendingRequests(trx: Transaction<DB>): Promise<ServiceRequestItem[]> {
    const rows = await trx
      .selectFrom('serviceRequests as r')
      .innerJoin('tenants as t', 't.id', 'r.tenantId')
      .innerJoin('services as s', 's.id', 'r.serviceId')
      .select([
        'r.id',
        'r.tenantId',
        't.name as tenantName',
        'r.serviceId',
        's.name as serviceName',
        's.basePriceDirams',
        'r.comment',
        'r.requestedAt',
      ])
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('tenantServices as ts')
              .select('ts.id')
              .whereRef('ts.tenantId', '=', 'r.tenantId')
              .whereRef('ts.requestId', '=', 'r.id'),
          ),
        ),
      )
      .orderBy('r.requestedAt')
      .orderBy('r.id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      serviceId: row.serviceId,
      serviceName: textOf(row.serviceName, 'ru') ?? '',
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      requestedAt: iso(row.requestedAt),
      basePriceMinor: Number(row.basePriceDirams),
      comment: row.comment,
    }));
  }

  /**
   * Today and the day of the decision of a service by the calendar of the platform
   * (`Asia/Dushanbe`, as the operators' journal); null for an unknown service.
   */
  async calendar(
    trx: Transaction<DB>,
    id: string,
  ): Promise<{ today: string; decidedOn: string } | null> {
    const { rows } = await sql<{ today: string; decidedOn: string }>`
      select (now() at time zone 'Asia/Dushanbe')::date::text as today,
             (decided_at at time zone 'Asia/Dushanbe')::date::text as "decidedOn"
      from pharmacy.tenant_services
      where id = ${id}`.execute(trx);
    return rows[0] ?? null;
  }

  async countPending(trx: Transaction<DB>): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      select count(*) as n
      from pharmacy.service_requests r
      where not exists (
        select 1 from pharmacy.tenant_services ts
        where ts.tenant_id = r.tenant_id and ts.request_id = r.id)`.execute(
      trx,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async request(trx: Transaction<DB>, id: string): Promise<RequestRow | null> {
    const row = await trx
      .selectFrom('serviceRequests')
      .select(['id', 'tenantId', 'serviceId'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row ?? null;
  }

  /** The archived flag of a service, or null for an unknown one. */
  async serviceArchived(
    trx: Transaction<DB>,
    id: string,
  ): Promise<boolean | null> {
    const row = await trx
      .selectFrom('services')
      .select('archived')
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? row.archived : null;
  }

  async tenantExists(trx: Transaction<DB>, id: string): Promise<boolean> {
    const row = await trx
      .selectFrom('tenants')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  async insertDecision(
    trx: Transaction<DB>,
    values: DecisionValues,
  ): Promise<void> {
    await trx
      .insertInto('tenantServices')
      .values({
        id: values.id,
        tenantId: values.tenantId,
        serviceId: values.serviceId,
        requestId: values.requestId,
        priceDirams:
          values.priceMinor === null ? null : BigInt(values.priceMinor),
        status: values.status,
        reason: values.reason,
        decidedBy: values.decidedBy,
        requestHash: values.requestHash ?? null,
      })
      .execute();
  }

  /** The request hash of a service; undefined when there is no service with this id. */
  async requestHashOf(
    trx: Transaction<DB>,
    id: string,
  ): Promise<Buffer | null | undefined> {
    const row = await trx
      .selectFrom('tenantServices')
      .select('requestHash')
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : row.requestHash;
  }

  /** The invoice a service is still on (A13), with what is paid on it and its VAT rate. */
  async activeLine(
    trx: Transaction<DB>,
    tenantServiceId: string,
  ): Promise<{
    invoiceId: string;
    paidDirams: bigint | string | number;
    vatBp: number;
  } | null> {
    const { rows } = await sql<{
      invoiceId: string;
      paidDirams: bigint | string | number;
      vatBp: number;
    }>`
      select l.invoice_id, i.paid_dirams, i.vat_bp
      from pharmacy.invoice_lines l
      join pharmacy.invoices i on i.id = l.invoice_id
      where l.tenant_service_id = ${tenantServiceId} and l.removed_at is null`.execute(
      trx,
    );
    return rows[0] ?? null;
  }

  /**
   * Changes a service while its status is one of `from`; false when it is not (or unknown). The
   * row stays locked to the commit.
   */
  async update(
    trx: Transaction<DB>,
    id: string,
    from: readonly TenantServiceStatus[],
    set: {
      status?: TenantServiceStatus;
      priceMinor?: number;
      reason?: string | null;
      providedOn?: string | null;
      providedBy?: string | null;
    },
  ): Promise<boolean> {
    const result = await trx
      .updateTable('tenantServices')
      .set({
        ...(set.status !== undefined && { status: set.status }),
        ...(set.priceMinor !== undefined && {
          priceDirams: BigInt(set.priceMinor),
        }),
        ...(set.reason !== undefined && { reason: set.reason }),
        ...(set.providedOn !== undefined && { providedOn: set.providedOn }),
        ...(set.providedBy !== undefined && { providedBy: set.providedBy }),
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('status', 'in', [...from])
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Services of networks with their request and decision, newest decision first. */
  async tenantServices(
    trx: Transaction<DB>,
    filter: TenantServiceFilter,
  ): Promise<TenantServiceItem[]> {
    let query = trx
      .selectFrom('tenantServices as ts')
      .innerJoin('tenants as t', 't.id', 'ts.tenantId')
      .innerJoin('services as s', 's.id', 'ts.serviceId')
      .innerJoin('operators as o', 'o.id', 'ts.decidedBy')
      .leftJoin('serviceRequests as r', (join) =>
        join
          .onRef('r.tenantId', '=', 'ts.tenantId')
          .onRef('r.id', '=', 'ts.requestId'),
      )
      .select([
        'ts.id',
        'ts.serviceId',
        's.name as serviceName',
        'ts.tenantId',
        't.name as tenantName',
        'ts.status',
        'ts.priceDirams',
        'ts.reason',
        'ts.requestId',
        'r.requestedAt',
        'r.comment',
        'ts.decidedAt',
        'o.fullName as decidedBy',
        'ts.providedOn',
      ])
      .orderBy('ts.decidedAt', 'desc')
      .orderBy('ts.id', 'desc');
    if (filter.id !== undefined) query = query.where('ts.id', '=', filter.id);
    if (filter.tenantId !== undefined)
      query = query.where('ts.tenantId', '=', filter.tenantId);
    if (filter.status !== undefined)
      query = query.where('ts.status', '=', filter.status);
    const rows = await query.execute();
    return rows.map((row) => ({
      id: row.id,
      serviceId: row.serviceId,
      serviceName: textOf(row.serviceName, 'ru') ?? '',
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      status: row.status as TenantServiceStatus,
      priceMinor: row.priceDirams === null ? null : Number(row.priceDirams),
      reason: row.reason,
      requestId: row.requestId,
      requestedAt: row.requestedAt === null ? null : iso(row.requestedAt),
      comment: row.comment ?? null,
      decidedAt: iso(row.decidedAt),
      decidedBy: row.decidedBy,
      providedOn: row.providedOn,
    }));
  }
}
