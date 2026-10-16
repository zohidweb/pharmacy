import { Injectable } from '@nestjs/common';
import type { SyncOperation, SyncOperationType } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../database';

/** An operation of an offline store ready to apply: the network and the store come from its license key. */
export type AppliedOperation<P = unknown> = SyncOperation<P> & {
  tenantId: string;
  storeId: string;
};

/**
 * Applies the facts of one or more operation types inside the tenant transaction the sync service opened
 * (ADR-0014 §4; spec 2026-10-16-offline-sync, E3): the rows of the store go in with its ids, without FEFO and
 * without a stock check. A refusal is a SyncApplyError; any other error quarantines the operation too.
 */
export interface FactApplier {
  readonly types: readonly SyncOperationType[];
  apply(trx: TenantTransaction, operation: AppliedOperation): Promise<void>;
}

/**
 * Why an operation cannot be applied: `quarantine` — it is wrong and waits for a person (E15); `dependency` —
 * a fact of the same store it refers to has not arrived yet, it is retried after every batch.
 */
export class SyncApplyError extends Error {
  constructor(
    readonly code: string,
    readonly kind: 'quarantine' | 'dependency' = 'quarantine',
  ) {
    super(code);
    this.name = 'SyncApplyError';
  }
}

// The registry of the appliers, filled by the modules that own the data (pos, returns, terminals, audit,
// inventory …) — the port pattern of PurchasePrices: a domain module never depends on the sync contour.
@Injectable()
export class SyncAppliers {
  private readonly byType = new Map<SyncOperationType, FactApplier>();

  register(applier: FactApplier): void {
    for (const type of applier.types) {
      if (this.byType.has(type)) {
        throw new Error(`A sync applier for ${type} is already registered`);
      }
      this.byType.set(type, applier);
    }
  }

  applierOf(type: string): FactApplier | undefined {
    return this.byType.get(type as SyncOperationType);
  }
}
