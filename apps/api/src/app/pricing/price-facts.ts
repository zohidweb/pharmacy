import { Injectable } from '@nestjs/common';
import type {
  PriceChangedLocallyPayload,
  SyncOperationType,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  isMoney,
  openConflict,
  requireEmployees,
  requireProducts,
  resolveOpenConflict,
  sameStore,
  storeTime,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import {
  PricingRepository,
  type StorePriceFact,
  type StorePriceRow,
} from './pricing.repository';

const isPrice = (value: unknown): value is number =>
  isMoney(value) && value > 0;

// The local prices of an offline store applied in the cloud (ADR-0014 §4; spec 2026-10-16-offline-sync, E25,
// E38). The store's price becomes the cloud price of that store when the cloud price is still the version the
// store saw; otherwise the cloud price stays and a price conflict opens for the owner. Either way the operation
// is applied: the store did change its own price, and its sales at that price are facts.
@Injectable()
export class PriceFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = ['price.changed-locally'];

  constructor(
    appliers: SyncAppliers,
    private readonly repository: PricingRepository,
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
    sameStore(payload.storeId, storeId);
    if (
      !isPrice(payload.retailPricePerPackDirams) ||
      (payload.retailPricePerPieceDirams !== null &&
        !isPrice(payload.retailPricePerPieceDirams))
    ) {
      throw new SyncApplyError('invalid_price');
    }
    const base = payload.basePriceVersion;
    if (base !== null && !(Number.isSafeInteger(base) && base >= 1)) {
      throw new SyncApplyError('invalid_price_version');
    }
    const fact: StorePriceFact = {
      tenantId,
      storeId,
      productId: payload.productId,
      priceDirams: payload.retailPricePerPackDirams,
      piecePriceDirams: payload.retailPricePerPieceDirams,
      changedBy: payload.changedBy,
      changedAt: storeTime(payload.changedAt),
    };
    await requireProducts(trx, tenantId, [fact.productId]);
    await requireEmployees(trx, tenantId, [fact.changedBy]);

    let current = await this.repository.lockStorePrice(
      trx,
      tenantId,
      storeId,
      fact.productId,
    );
    if (current === null) {
      if (await this.repository.insertStorePriceFromStore(trx, fact)) {
        await this.closeConflict(trx, fact);
        return this.appendAudit(trx, tenantId, storeId, payload.audit);
      }
      // a writer of the cloud inserted the row meanwhile: compare with it
      current = await this.repository.lockStorePrice(
        trx,
        tenantId,
        storeId,
        fact.productId,
      );
      if (current === null) throw new Error('The store price row vanished');
    }

    if (current.priceDirams === null || current.priceVersion === base) {
      await this.repository.updateStorePriceFromStore(trx, fact);
      await this.closeConflict(trx, fact);
    } else {
      await openConflict(
        trx,
        {
          tenantId,
          storeId,
          kind: 'price',
          entityId: fact.productId,
          localValue: {
            priceDirams: fact.priceDirams,
            piecePriceDirams: fact.piecePriceDirams,
            basePriceVersion: base,
            changedBy: fact.changedBy,
            changedAt: fact.changedAt.toISOString(),
          },
          cloudValue: cloudValue(current),
        },
        'refresh',
      );
    }
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  // A store change made after it saw the current cloud price is a new decision of the store (E38): an open
  // conflict about the same price is closed in its favour.
  private closeConflict(
    trx: TenantTransaction,
    fact: StorePriceFact,
  ): Promise<void> {
    return resolveOpenConflict(trx, {
      tenantId: fact.tenantId,
      storeId: fact.storeId,
      kind: 'price',
      entityId: fact.productId,
      resolution: 'local',
      resolvedBy: fact.changedBy,
      resolvedAt: new Date(),
    });
  }

  private async appendAudit(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    rows: PriceChangedLocallyPayload['audit'],
  ): Promise<void> {
    for (const row of rows) {
      if (row.storeId !== null) sameStore(row.storeId, storeId);
      await this.audit.appendFact(trx, tenantId, row, storeId);
    }
  }
}

function cloudValue(row: StorePriceRow): Record<string, unknown> {
  return {
    priceDirams: row.priceDirams === null ? null : Number(row.priceDirams),
    piecePriceDirams:
      row.piecePriceDirams === null ? null : Number(row.piecePriceDirams),
    priceVersion: row.priceVersion,
    changedBy: row.priceChangedBy,
    changedAt: row.priceChangedAt?.toISOString() ?? null,
  };
}
