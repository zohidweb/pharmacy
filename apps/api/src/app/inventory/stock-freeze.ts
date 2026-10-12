import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import type { TenantTransaction } from '../../core/database';
import { ProductsReader } from '../catalog/products-reader';

const key = (tenantId: string, storeId: string) =>
  sql`hashtextextended(${`stock:${tenantId}:${storeId}`}, 0)`;

// The freeze of a running stock count (spec 2026-10-12-write-offs-stock-counts, section 5.3): the
// products of its scope are not posted or unposted by stock documents of the store until the count
// is posted or cancelled; the POS keeps selling. A store-level advisory lock orders a count start,
// posting, unposting and cancellation (exclusive) against document postings (shared), so a
// document is either in the snapshot of a count or rejected by it. Runs in the caller's transaction.
@Injectable()
export class StockFreeze {
  constructor(private readonly products: ProductsReader) {}

  /** Shared lock of the stock of the store for a document posting or unposting. */
  async lockShared(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock_shared(${key(tenantId, storeId)})`.execute(
      trx,
    );
  }

  /** Exclusive lock for a stock count start, posting, unposting and cancellation. */
  async lockExclusive(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(${key(tenantId, storeId)})`.execute(
      trx,
    );
  }

  /**
   * 409 `stock_count_in_progress` with errors at `lines.i.productId` when a product of the lines
   * (in their order) is in the scope of a running count of the store.
   */
  async assertNotFrozen(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    productIds: readonly string[],
    exceptDocumentId?: string,
  ): Promise<void> {
    const running = await sql<{ scope: string; categoryId: string | null }>`
      select inventory_scope as scope, inventory_category_id as category_id
      from pharmacy.documents
      where tenant_id = ${tenantId} and store_id = ${storeId}
        and type = 'inventory' and status = 'draft'
        ${exceptDocumentId ? sql`and id <> ${exceptDocumentId}` : sql``}`.execute(
      trx,
    );
    if (running.rows.length === 0 || productIds.length === 0) return;
    const whole = running.rows.some((r) => r.scope === 'all');
    const categories = new Set(
      running.rows.flatMap((r) => (r.categoryId ? [r.categoryId] : [])),
    );
    const categoryOf = whole
      ? new Map<string, string>()
      : new Map(
          (
            await this.products.findForStock(trx, tenantId, [
              ...new Set(productIds),
            ])
          ).map((p) => [p.id, p.categoryId]),
        );
    const frozen = productIds.flatMap((productId, i) =>
      whole || categories.has(categoryOf.get(productId) ?? '')
        ? [{ field: `lines.${i}.productId`, code: 'stock_count_in_progress' }]
        : [],
    );
    if (frozen.length > 0) {
      throw new FieldProblemException(409, 'stock_count_in_progress', frozen);
    }
  }

  /** Both: the shared lock, then the check — for a document posting or unposting. */
  async guard(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    productIds: readonly string[],
  ): Promise<void> {
    await this.lockShared(trx, tenantId, storeId);
    await this.assertNotFrozen(trx, tenantId, storeId, productIds);
  }
}
