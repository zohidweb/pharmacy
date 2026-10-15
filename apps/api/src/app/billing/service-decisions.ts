import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { OwnerServicesRepository, textOf } from './owner-services.repository';

export interface ServiceDecision {
  id: string;
  /** The names of the service, `ru` always, `tj` when the operator gave one. */
  serviceNames: { ru: string; tj?: string };
  decision: 'approved' | 'rejected' | 'cancelled';
  priceMinor: number | null;
  reason: string | null;
  decidedAt: Date;
}

// The operator's decisions on the services of a network, for its notifications (spec
// 2026-10-15-billing-services, A17: `service_decided`). Exported by BillingModule; read in the
// tenant transaction of the notifications refresh.
@Injectable()
export class ServiceDecisions {
  constructor(private readonly repository: OwnerServicesRepository) {}

  async decidedSince(
    trx: TenantTransaction,
    tenantId: string,
    since: Date,
  ): Promise<ServiceDecision[]> {
    const rows = await this.repository.decidedSince(trx, tenantId, since);
    return rows.map((row) => {
      const tj = textOf(row.name, 'tj');
      return {
        id: row.id,
        serviceNames: { ru: textOf(row.name, 'ru') ?? '', ...(tj && { tj }) },
        decision: row.status,
        priceMinor: row.priceDirams === null ? null : Number(row.priceDirams),
        reason: row.reason,
        decidedAt: new Date(row.decidedAt),
      };
    });
  }
}
