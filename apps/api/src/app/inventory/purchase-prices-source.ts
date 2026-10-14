import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { PurchasePrices } from '../pricing/purchase-prices';

// The last purchase price of a pack for the price list (spec 2026-10-14-owner-cabinet, E15): the
// batch of the last posted goods receipt of the product in the network. Opening balances, surplus
// and transferred batches carry no purchase of their own and are not counted.
@Injectable()
export class PurchasePricesSource {
  constructor(prices: PurchasePrices) {
    prices.register((trx, tenantId, productIds) =>
      this.lastPackCosts(trx, tenantId, productIds),
    );
  }

  private async lastPackCosts(
    trx: TenantTransaction,
    tenantId: string,
    productIds: readonly string[],
  ): Promise<Map<string, number>> {
    const result = await sql<{ productId: string; packCost: string }>`
      select distinct on (b.product_id)
             b.product_id, b.purchase_price_per_pack_dirams as pack_cost
      from pharmacy.batches b
      join pharmacy.documents d
        on d.tenant_id = b.tenant_id and d.id = b.source_document_id
      where b.tenant_id = ${tenantId}
        and b.product_id = any(${sql.val([...productIds])}::uuid[])
        and b.origin = 'goods_receipt'
        and d.type = 'goods_receipt'
        and d.status = 'posted'
      order by b.product_id, d.posted_at desc, b.created_at desc`.execute(trx);
    return new Map(
      result.rows.map((row) => [row.productId, Number(row.packCost)]),
    );
  }
}
