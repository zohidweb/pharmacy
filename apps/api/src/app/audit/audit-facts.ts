import { Injectable } from '@nestjs/common';
import type {
  AuditRecordedPayload,
  SyncOperationType,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  sameStore,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from './audit.service';

// An action of an offline store without a domain operation (sign-ins, wrong PINs, refusals — ADR-0014 §4): one row
// of the journal of the store, inserted as the store wrote it.
@Injectable()
export class AuditFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = ['audit.recorded'];

  constructor(
    appliers: SyncAppliers,
    private readonly audit: AuditService,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    const { tenantId, storeId, payload } =
      operation as AppliedOperation<AuditRecordedPayload>;
    if (payload.audit.storeId !== null)
      sameStore(payload.audit.storeId, storeId);
    await this.audit.appendFact(trx, tenantId, payload.audit, storeId);
  }
}
