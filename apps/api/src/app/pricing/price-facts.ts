import { Injectable } from '@nestjs/common';
import type {
  PriceChangedLocallyPayload,
  SyncOperationType,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  sameStore,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import { LocalPriceRule } from './local-price-rule';

// The local prices of an offline store applied in the cloud (ADR-0014 §4; spec 2026-10-16-offline-sync, E25,
// E38): the rule is LocalPriceRule. Either way the operation is applied: the store did change its own price, and
// its sales at that price are facts.
@Injectable()
export class PriceFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = ['price.changed-locally'];

  constructor(
    appliers: SyncAppliers,
    private readonly rule: LocalPriceRule,
    private readonly audit: AuditService,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    if (operation.type !== 'price.changed-locally') {
      throw new SyncApplyError('unsupported_type');
    }
    const { tenantId, storeId, payload } =
      operation as AppliedOperation<PriceChangedLocallyPayload>;
    const { audit, ...price } = payload;
    await this.rule.apply(trx, tenantId, storeId, price);
    for (const row of audit) {
      if (row.storeId !== null) sameStore(row.storeId, storeId);
      await this.audit.appendFact(trx, tenantId, row, storeId);
    }
  }
}
