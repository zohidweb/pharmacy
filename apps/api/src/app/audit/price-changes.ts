import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

// The history of the prices of a store (security review 2026-10-22, I2; ADR-0015, amendment 2026-10-23): a price of a
// store changes only through StorePriceWriter, which records `price.changed` with the old and the new price in the
// same transaction. The POS asks what a product cost at the moment of its catalog snapshot. Read in the caller's
// transaction, by audit_log_entity_idx; the cloud changes only (an offline store keeps its own prices). The pack price
// only: the own piece price of a store changes in the cloud only by a copy to a store without a price (no old one).
@Injectable()
export class PriceChanges {
  /**
   * For each product whose price at the store changed after `after`: the price before the first of those changes
   * (null — the store had no price then). Products without a change are absent.
   */
  async oldPricesAfter(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    productIds: readonly string[],
    after: Date,
  ): Promise<Map<string, number | null>> {
    if (productIds.length === 0) return new Map();
    const result = await sql<{
      productId: string;
      oldPriceMinor: string | null;
    }>`
      select distinct on (a.entity_id) a.entity_id as product_id,
             a.details ->> 'oldPriceMinor' as old_price_minor
      from pharmacy.audit_log a
      where a.tenant_id = ${tenantId} and a.entity_type = 'product'
        and a.entity_id = any(${sql.val([...productIds])}::uuid[])
        and a.recorded_at > ${after}
        and a.action = 'price.changed' and a.source = 'cloud' and a.store_id = ${storeId}
      order by a.entity_id, a.recorded_at, a.id`.execute(trx);
    return new Map(
      result.rows.map((row) => [
        row.productId,
        row.oldPriceMinor === null ? null : Number(row.oldPriceMinor),
      ]),
    );
  }
}
