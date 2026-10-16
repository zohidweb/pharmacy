import { Injectable } from '@nestjs/common';
import type {
  CreateServiceRequestBody,
  ServiceOrder,
  ServiceOrderStatus,
  TenantServices,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import {
  foreignKeyConstraint,
  newId,
  TenantDatabase,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  localized,
  type OrderRow,
  OwnerServicesRepository,
} from './owner-services.repository';

const notFound = () => new ProblemException(404, 'not_found');
const decided = () => new ProblemException(409, 'service_decided');

function toOrder(row: OrderRow, locale: 'ru' | 'tg'): ServiceOrder {
  return {
    requestId: row.requestId,
    serviceId: row.serviceId,
    serviceName: localized(row.name, locale),
    status: (row.status ?? 'pending') as ServiceOrderStatus,
    comment: row.comment,
    requestedAt:
      row.requestedAt === null ? null : new Date(row.requestedAt).toISOString(),
    priceMinor: row.priceDirams === null ? null : Number(row.priceDirams),
    reason: row.reason,
    providedOn: row.providedOn,
    decidedAt:
      row.decidedAt === null ? null : new Date(row.decidedAt).toISOString(),
  };
}

// The services of the owner cabinet (spec 2026-10-15-billing-services, B7–B9, A12, 6.2): the
// operator's catalog, the network's requests and the decisions on them. A request is withdrawn
// only while it waits for a decision.
@Injectable()
export class OwnerServicesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: OwnerServicesRepository,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<TenantServices> {
    const { tenantId, locale } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const catalog = await this.repository.catalog(trx);
      const orders = await this.repository.orders(trx, tenantId);
      return {
        catalog: catalog.map((row) => ({
          id: row.id,
          name: localized(row.name, locale),
          description: localized(row.description, locale),
          basePriceMinor: Number(row.basePriceDirams),
        })),
        orders: orders.map((row) => toOrder(row, locale)),
      };
    });
  }

  /** 404 (unknown, hidden or archived service), 409 `service_requested`. */
  request(body: CreateServiceRequestBody): Promise<ServiceOrder> {
    const { tenantId, employeeId, locale } = requirePrincipal();
    const serviceId = body.serviceId.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      await this.repository.lockService(trx, tenantId, serviceId);
      if (!(await this.repository.offered(trx, serviceId))) throw notFound();
      if (await this.repository.pendingExists(trx, tenantId, serviceId)) {
        throw new ProblemException(409, 'service_requested');
      }
      const id = newId();
      await this.repository.insertRequest(trx, {
        tenantId,
        id,
        serviceId,
        comment: body.comment,
        requestedBy: employeeId,
      });
      await this.audit.append(trx, {
        action: 'settings.service-requested',
        entityType: 'service_request',
        entityId: id,
        details: { serviceId },
      });
      const orders = await this.repository.orders(trx, tenantId);
      const created = orders.find((row) => row.requestId === id);
      if (created === undefined)
        throw new Error('The created request is not found');
      return toOrder(created, locale);
    });
  }

  /**
   * 404, 409 `service_decided`. A decision committed meanwhile fails the foreign key of the
   * delete, which answers the same 409.
   */
  async withdraw(requestId: string): Promise<void> {
    const { tenantId } = requirePrincipal();
    const id = requestId.toLowerCase();
    try {
      await this.db.tenantTransaction(async (trx) => {
        const state = await this.repository.requestState(trx, tenantId, id);
        if (state === null) throw notFound();
        if (state === 'decided') throw decided();
        const serviceId = await this.repository.deleteRequest(
          trx,
          tenantId,
          id,
        );
        // the journal names the service by it: the request row is gone
        await this.audit.append(trx, {
          action: 'settings.service-request-withdrawn',
          entityType: 'service_request',
          entityId: id,
          details: { serviceId },
        });
      });
    } catch (error) {
      if (foreignKeyConstraint(error) !== null) throw decided();
      throw error;
    }
  }
}
