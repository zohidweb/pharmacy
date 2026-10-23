import { Injectable } from '@nestjs/common';
import type {
  ServiceRequestItem,
  TenantServiceItem,
  TenantServiceQuery,
  TenantServiceStatus,
} from '@pharmacy/shared-dto';
import { vatOf } from '@pharmacy/shared-domain';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { requestHash } from '../../../common/request-hash';
import {
  type DB,
  foreignKeyConstraint,
  newId,
  uniqueConstraint,
} from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { TenantAllocation } from './allocation';
import { InvoicesRepository } from './invoices.repository';
import { ServiceOrdersRepository } from './service-orders.repository';

const DECISION_OF_REQUEST = 'tenant_services_request_uq';

const notFound = () => new ProblemException(404, 'not_found');
const decided = () => new ProblemException(409, 'service_decided');
const notApproved = () => new ProblemException(409, 'service_not_approved');
const invoiced = () => new ProblemException(409, 'service_invoiced');
const SERVICE_KEY = 'tenant_services_pkey';
const badDate = (code: 'future' | 'before_decision') =>
  new FieldProblemException(400, 'validation_failed', [
    { field: 'providedOn', code },
  ]);

// Statuses a service may be in for each change (spec 2026-10-15-billing-services, A13). A service on
// an invoice keeps its price and its «оказано» mark (409 `service_invoiced`); its cancellation takes
// the line off an invoice without payments. Changes take the row of the network first, the lock
// the generation of invoices holds.
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
    private readonly invoices: InvoicesRepository,
    private readonly allocation: TenantAllocation,
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

  /**
   * A service without a request, approved at once; 404 for an unknown network or an archived service.
   * `key` — the client id of the service (B17): the same request gets the service as it is now,
   * another one with the key 409 `idempotency_conflict`.
   */
  async add(
    tenantId: string,
    serviceId: string,
    priceMinor: number,
    key: string,
  ): Promise<TenantServiceItem> {
    const actor = this.actor();
    const tenant = tenantId.toLowerCase();
    const service = serviceId.toLowerCase();
    const id = key.toLowerCase();
    const hash = requestHash({
      tenantId: tenant,
      serviceId: service,
      priceMinor,
    });
    try {
      return await this.db.platformTransaction(actor, async (trx) => {
        const stored = await this.repository.requestHashOf(trx, id);
        if (stored !== undefined) return this.replayAdd(trx, id, stored, hash);
        if (!(await this.repository.tenantExists(trx, tenant)))
          throw notFound();
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
          requestHash: hash,
        });
        await this.event(trx, 'service.added', tenant, id);
        return this.one(trx, id);
      });
    } catch (error) {
      // a concurrent repeat with the key committed first
      if (uniqueConstraint(error) !== SERVICE_KEY) throw error;
      return this.db.platformTransaction(actor, async (trx) => {
        const stored = await this.repository.requestHashOf(trx, id);
        if (stored === undefined) throw error;
        return this.replayAdd(trx, id, stored, hash);
      });
    }
  }

  private replayAdd(
    trx: Transaction<DB>,
    id: string,
    stored: Buffer | null,
    hash: Buffer,
  ): Promise<TenantServiceItem> {
    if (stored === null || !Buffer.from(stored).equals(hash)) {
      throw new ProblemException(409, 'idempotency_conflict');
    }
    return this.one(trx, id);
  }

  /** Not in the future and not before the day of the decision, by the calendar of the platform. */
  async provide(
    serviceId: string,
    providedOn: string,
  ): Promise<TenantServiceItem> {
    const actor = this.actor();
    const id = serviceId.toLowerCase();
    return this.db.platformTransaction(actor, async (trx) => {
      const current = await this.existing(trx, id);
      if (current.status !== 'approved') throw notApproved();
      const days = await this.repository.calendar(trx, id);
      if (days === null) throw notFound();
      if (providedOn > days.today) throw badDate('future');
      if (providedOn < days.decidedOn) throw badDate('before_decision');
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

  /**
   * A service on an invoice without payments leaves it: its line is removed (B18) and the sums of the
   * invoice and the allocation of the network are computed again. On an invoice with a payment — 409
   * `service_invoiced`.
   */
  cancel(serviceId: string, reason: string): Promise<TenantServiceItem> {
    const id = serviceId.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const current = await this.existing(trx, id);
      await this.invoices.lockTenants(trx, [current.tenantId]);
      const line = await this.repository.activeLine(trx, id);
      if (line !== null && Number(line.paidDirams) > 0) throw invoiced();
      const changed = await this.repository.update(trx, id, ACTIVE, {
        status: 'cancelled',
        reason,
        providedOn: null,
        providedBy: null,
      });
      if (!changed) throw notApproved();
      if (line !== null) {
        await this.invoices.removeLines(
          trx,
          line.invoiceId,
          { tenantServiceId: id },
          'service_cancelled',
        );
        const lines = await this.invoices.activeLines(trx, line.invoiceId);
        const subtotalMinor = lines.reduce(
          (sum, row) => sum + Number(row.amountDirams),
          0,
        );
        const vatMinor = vatOf(subtotalMinor, line.vatBp);
        await this.invoices.updateSums(
          trx,
          line.invoiceId,
          { subtotalMinor, vatMinor, totalMinor: subtotalMinor + vatMinor },
          false,
        );
        await this.allocation.recompute(trx, current.tenantId);
      }
      await this.event(trx, 'service.cancelled', current.tenantId, id);
      return this.one(trx, id);
    });
  }

  /** A change of a service not on an invoice (A13); 409 `service_invoiced` otherwise. */
  private async change(
    serviceId: string,
    from: readonly TenantServiceStatus[],
    action: string,
    set: Parameters<ServiceOrdersRepository['update']>[3],
  ): Promise<TenantServiceItem> {
    const id = serviceId.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const current = await this.existing(trx, id);
      await this.invoices.lockTenants(trx, [current.tenantId]);
      if ((await this.repository.activeLine(trx, id)) !== null)
        throw invoiced();
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
