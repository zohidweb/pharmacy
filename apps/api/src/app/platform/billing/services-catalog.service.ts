import { Injectable } from '@nestjs/common';
import type {
  PlatformService,
  UpsertServiceRequest,
} from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { BillingRepository } from './billing.repository';

const notFound = () => new ProblemException(404, 'not_found');

// The catalog of one-time services (spec 2026-10-15-billing-services, B7, B8, A14). A service is
// never deleted: an archived one leaves the catalog and cannot be added to a network.
@Injectable()
export class ServicesCatalogService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: BillingRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  list(): Promise<PlatformService[]> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.services(trx),
    );
  }

  async create(service: UpsertServiceRequest): Promise<PlatformService> {
    const id = newId();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      await this.repository.insertService(trx, id, service);
      await this.audit.append(trx, {
        action: 'service.created',
        entityType: 'service',
        entityId: id,
      });
      const [created] = await this.repository.services(trx, id);
      return created;
    });
  }

  /** 404 for an unknown service. */
  async update(
    serviceId: string,
    service: UpsertServiceRequest,
  ): Promise<PlatformService> {
    // canonical: the pipe accepts upper case, the journal and the answer carry the stored form
    const id = serviceId.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      if (!(await this.repository.updateService(trx, id, service)))
        throw notFound();
      await this.audit.append(trx, {
        action: 'service.updated',
        entityType: 'service',
        entityId: id,
      });
      const [updated] = await this.repository.services(trx, id);
      return updated;
    });
  }
}
