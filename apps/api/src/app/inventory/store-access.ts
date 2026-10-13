import { Injectable } from '@nestjs/common';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import type { TenantTransaction } from '../../core/database';
import {
  InventoryRepository,
  type StoreForWrite,
} from './inventory.repository';

// The store rules of the stock documents (spec 2026-10-09, 4.1; 2026-10-12, 4–5): a document is
// seen and written only in the stores of the employee scope; the cloud writes only an active cloud
// store (ADR-0014: an offline store keeps its own stock documents).
@Injectable()
export class StoreAccess {
  constructor(private readonly inventory: InventoryRepository) {}

  /** The stores of the employee scope; null — every store. */
  scope(): readonly string[] | null {
    const { storeScope } = requirePrincipal();
    return storeScope === 'all' ? null : storeScope;
  }

  /** 403 `store_not_in_scope`. */
  inScope(storeId: string): void {
    const scope = this.scope();
    if (scope !== null && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
  }

  /** The store of a write: in the scope (403), active (404) and a cloud store (409). */
  async writableStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<StoreForWrite> {
    this.inScope(storeId);
    const store = await this.inventory.store(trx, tenantId, storeId);
    if (store === null || store.status !== 'active') {
      throw new ProblemException(404, 'not_found');
    }
    if (store.mode !== 'online') {
      throw new ProblemException(409, 'offline_store_read_only');
    }
    return store;
  }

  /**
   * The other store of a transfer or a request (spec 2026-10-12-supplier-returns-transfers, 5.1):
   * an active store of the network — the scope does not limit it — and a cloud one (409
   * `offline_store_read_only`: transfers with offline stores wait for the sync, T9).
   */
  async counterpartStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    field: string,
  ): Promise<StoreForWrite> {
    const store = await this.inventory.store(trx, tenantId, storeId);
    if (store === null || store.status !== 'active') {
      throw new FieldProblemException(400, 'validation_failed', [
        { field, code: 'unknown_store' },
      ]);
    }
    if (store.mode !== 'online') {
      throw new ProblemException(409, 'offline_store_read_only');
    }
    return store;
  }
}
