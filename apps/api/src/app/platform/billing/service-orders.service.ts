import { Injectable } from '@nestjs/common';
import type {
  ServiceRequestItem,
  TenantServiceItem,
  TenantServiceQuery,
  TenantServiceStatus,
} from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import {
  type DB,
  foreignKeyConstraint,
  newId,
  uniqueConstraint,
} from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { ServiceOrdersRepository } from './service-orders.repository';

const DECISION_OF_REQUEST = 'tenant_services_request_uq';

const notFound = () => new ProblemException(404, 'not_found');
const decided = () => new ProblemException(409, 'service_decided');
const notApproved = () => new ProblemException(409, 'service_not_approved');
const badDate = (code: 'future' | 'before_decision') =>
  new FieldProblemException(400, 'validation_failed', [
    { field: 'providedOn', code },
  ]);

// Statuses a service may be in for each change (spec 2026-10-15-billing-services, A13). Checks that
// a service is already on an invoice (409 `service_invoiced`) come with the invoices of PR 2.
const ACTIVE: readonly TenantServiceStatus[] = ['approved', 'provided'];

// The operator's side of the services of networks (spec A12, A13): decisions on requests,
// services added without one, the «оказано» mark, the price and cancellation. Every change is one
// platform transaction with its event in platform_audit_log.
@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: ServiceOrdersRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  pendingRequests(): Promise<ServiceRequestItem[]> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.pendingRequests(trx),
    );
  }

  pendingCount(): Promise<number> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.countPending(trx),
    );
  }

  list(query: TenantServiceQuery): Promise<TenantServiceItem[]> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.tenantServices(trx, {
        tenantId: query.tenantId?.toLowerCase(),
        status: query.status,
      }),
    );
  }

  /** The services of one network; 404 for an unknown network. */
  ofTenant(tenantId: string): Promise<TenantServiceItem[]> {
    const id = tenantId.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      if (!(await this.repository.tenantExists(trx, id))) throw notFound();
      return this.repository.tenantServices(trx, { tenantId: id });
    });
  }

  approve(requestId: string, priceMinor: number): Promise<TenantServiceItem> {
    return this.decide(requestId, {
      status: 'approved',
      priceMinor,
      reason: null,
    });
  }

  reject(requestId: string, reason: string): Promise<TenantServiceItem> {
    return this.decide(requestId, {
      status: 'rejected',
      priceMinor: null,
      reason,
    });
  }

  /**
   * One decision per request: a second one meets the unique request_id (409 `service_decided`); a
   * request withdrawn meanwhile fails the foreign key (404). The owner's withdrawal, in turn, meets
   * the foreign key of the decision and answers 409.
   */
  private async decide(
    requestId: string,
    decision: {
      status: 'approved' | 'rejected';
      priceMinor: number | null;
      reason: string | null;
    },
  ): Promise<TenantServiceItem> {
    const actor = this.actor();
    const id = newId();
    try {
      return await this.db.platformTransaction(actor, async (trx) => {
        const request = await this.repository.request(
          trx,
          requestId.toLowerCase(),
        );
        if (request === null) throw notFound();
        await this.repository.insertDecision(trx, {
          id,
          tenantId: request.tenantId,
          serviceId: request.serviceId,
          requestId: request.id,
          decidedBy: actor.operatorId,
          ...decision,
        });
        await this.event(
          trx,
          `service.${decision.status}`,
          request.tenantId,
          id,
        );
        return this.one(trx, id);
      });
    } catch (error) {
      if (uniqueConstraint(error) === DECISION_OF_REQUEST) throw decided();
      if (foreignKeyConstraint(error) !== null) throw notFound();
      throw error;
    }
  }

  /** A service without a request, approved at once; 404 for an unknown network or an archived service. */
  async add(
    tenantId: string,
    serviceId: string,
    priceMinor: number,
  ): Promise<TenantServiceItem> {
    const actor = this.actor();
    const tenant = tenantId.toLowerCase();
    const service = serviceId.toLowerCase();
    const id = newId();
    return this.db.platformTransaction(actor, async (trx) => {
      if (!(await this.repository.tenantExists(trx, tenant))) throw notFound();
      if ((await this.repository.serviceArchived(trx, service)) !== false)
        throw notFound();
      await this.repository.insertDecision(trx, {
        id,
        tenantId: tenant,
        serviceId: service,
        requestId: null,
        priceMinor,
        status: 'approved',
        reason: null,
        decidedBy: actor.operatorId,
      });
      await this.event(trx, 'service.added', tenant, id);
      return this.one(trx, id);
    });
  }

  /** Not in the future and not before the day of the decision, by the calendar of `Asia/Dushanbe`. */
  async provide(
    serviceId: string,
    providedOn: string,
  ): Promise<TenantServiceItem> {
    const actor = this.actor();
    const id = serviceId.toLowerCase();
    return this.db.platformTransaction(actor, async (trx) => {
      const current = await this.existing(trx, id);
      if (current.status !== 'approved') throw notApproved();
      if (providedOn > toAppDate()) throw badDate('future');
      if (providedOn < toAppDate(new Date(current.decidedAt)))
        throw badDate('before_decision');
      const changed = await this.repository.update(trx, id, ['approved'], {
        status: 'provided',
        providedOn,
        providedBy: actor.operatorId,
      });
      if (!changed) throw notApproved();
      await this.event(trx, 'service.provided', current.tenantId, id);
      return this.one(trx, id);
    });
  }

  /** Back to approved; 409 `service_not_approved` unless provided. */
  undoProvision(serviceId: string): Promise<TenantServiceItem> {
    return this.change(serviceId, ['provided'], 'service.provision-undone', {
      status: 'approved',
      providedOn: null,
      providedBy: null,
    });
  }

  updatePrice(
    serviceId: string,
    priceMinor: number,
  ): Promise<TenantServiceItem> {
    return this.change(serviceId, ACTIVE, 'service.price-changed', {
      priceMinor,
    });
  }

  cancel(serviceId: string, reason: string): Promise<TenantServiceItem> {
    return this.change(serviceId, ACTIVE, 'service.cancelled', {
      status: 'cancelled',
      reason,
      providedOn: null,
      providedBy: null,
    });
  }

  private async change(
    serviceId: string,
    from: readonly TenantServiceStatus[],
    action: string,
    set: Parameters<ServiceOrdersRepository['update']>[3],
  ): Promise<TenantServiceItem> {
    const id = serviceId.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const current = await this.existing(trx, id);
      if (!(await this.repository.update(trx, id, from, set)))
        throw notApproved();
      await this.event(trx, action, current.tenantId, id);
      return this.one(trx, id);
    });
  }

  private async existing(
    trx: Transaction<DB>,
    id: string,
  ): Promise<TenantServiceItem> {
    const [found] = await this.repository.tenantServices(trx, { id });
    if (found === undefined) throw notFound();
    return found;
  }

  private async one(
    trx: Transaction<DB>,
    id: string,
  ): Promise<TenantServiceItem> {
    const [found] = await this.repository.tenantServices(trx, { id });
    return found;
  }

  private event(
    trx: Transaction<DB>,
    action: string,
    tenantId: string,
    id: string,
  ) {
    return this.audit.append(trx, {
      action,
      tenantId,
      entityType: 'tenant_service',
      entityId: id,
    });
  }
}
