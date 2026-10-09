import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import type { TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { PricingRepository } from './pricing.repository';

export interface StorePriceChange {
  tenantId: string;
  productId: string;
  storeId: string;
  priceMinor: number;
  maxPriceMinor: number | null;
  /** A price above the regulated maximum is a soft warning the editor confirms (ТЗ). */
  confirmAboveMax: boolean;
  /** Field of the request an error names, e.g. `prices` or `lines.2.retailPriceMinor`. */
  field: string;
  source: 'prices' | 'document';
  documentId?: string;
}

// The public interface of the prices of the stores (ADR-0002): the «Цены» screen and the stock
// documents set a price only through it — the same rights, the regulated maximum, the version of
// the price and the audit (spec 2026-10-09-inventory-purchasing, section 4.1, step 5). Runs in the
// caller's transaction.
@Injectable()
export class StorePriceWriter {
  constructor(
    private readonly repository: PricingRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Sets the price of a pack at a store. 403 `forbidden` / `store_not_in_scope` without the right
   * on the store, 422 `above_max_price` at `field` unless confirmed.
   */
  async set(
    trx: TenantTransaction,
    change: StorePriceChange,
  ): Promise<'changed' | 'unchanged'> {
    const { permissions, storeScope, employeeId } = requirePrincipal();
    const current = await this.repository.lockPrices(
      trx,
      change.tenantId,
      change.productId,
      [change.storeId],
    );
    const old = current.get(change.storeId) ?? null;
    if (old !== null && Number(old) === change.priceMinor) return 'unchanged';

    const network = hasPermissions(permissions, 'pricing:update-network');
    if (!network && !hasPermissions(permissions, 'pricing:update-store')) {
      throw new ProblemException(403, 'forbidden');
    }
    if (
      !network &&
      storeScope !== 'all' &&
      !storeScope.includes(change.storeId)
    ) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    if (
      !change.confirmAboveMax &&
      change.maxPriceMinor !== null &&
      change.priceMinor > change.maxPriceMinor
    ) {
      throw new FieldProblemException(422, 'above_max_price', [
        { field: change.field, code: 'above_max_price' },
      ]);
    }

    await this.repository.setPrice(
      trx,
      change.tenantId,
      change.productId,
      change.storeId,
      change.priceMinor,
      employeeId,
    );
    await this.audit.append(trx, {
      action: 'price.changed',
      entityType: 'product',
      entityId: change.productId,
      storeId: change.storeId,
      details: {
        storeId: change.storeId,
        oldPriceMinor: old === null ? null : Number(old),
        newPriceMinor: change.priceMinor,
        source: change.source,
        ...(change.documentId ? { documentId: change.documentId } : {}),
      },
    });
    return 'changed';
  }

  /** Every product with a price at the stores: key `${storeId}/${productId}` → price of a pack. */
  async pricedAt(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
  ): Promise<Map<string, number>> {
    const cells = await this.repository.pricesOfStores(trx, tenantId, storeIds);
    return new Map(
      cells.map((c) => [`${c.storeId}/${c.productId}`, Number(c.priceDirams)]),
    );
  }

  /** Prices of packs at the stores; no key `${storeId}/${productId}` — not sold there. */
  async pricesAt(
    trx: TenantTransaction,
    tenantId: string,
    storeIds: readonly string[],
    productIds: readonly string[],
  ): Promise<Map<string, number>> {
    const cells = await this.repository.prices(
      trx,
      tenantId,
      productIds,
      storeIds,
    );
    const map = new Map<string, number>();
    for (const cell of cells) {
      if (cell.priceDirams !== null) {
        map.set(`${cell.storeId}/${cell.productId}`, Number(cell.priceDirams));
      }
    }
    return map;
  }
}
