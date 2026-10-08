import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface StoreRef {
  id: string;
  name: string;
}

export interface PriceCell {
  productId: string;
  storeId: string;
  priceDirams: bigint | null;
}

export interface RuleRow {
  id: string;
  name: unknown;
  level: string;
  validFrom: string | null;
  validTo: string | null;
  createdAt: Date;
  authorName: string;
  authorRole: unknown;
}

export interface RuleValues {
  name: Record<string, string>;
  storeIds: readonly string[] | null;
  validFrom: string | null;
  validTo: string | null;
  tiers: ReadonlyArray<{ minTotalDirams: number; percentBp: number }>;
}

// Data access of prices and discount rules (spec 2026-10-07-catalog-pricing, section 6). Products
// are read through the catalog's ProductsReader, never here.
@Injectable()
export class PricingRepository {
  async settings(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<{ language: 'ru' | 'tj'; timezone: string }> {
    const row = await trx
      .selectFrom('tenantSettings')
      .select(['defaultLanguage', 'timezone'])
      .where('tenantId', '=', tenantId)
      .executeTakeFirst();
    return {
      language: row?.defaultLanguage === 'tj' ? 'tj' : 'ru',
      timezone: row?.timezone ?? 'Asia/Dushanbe',
    };
  }

  /** Active stores of the network; `scope` null — every one, otherwise only these ids. */
  async activeStores(
    trx: TenantTransaction,
    tenantId: string,
    scope: readonly string[] | null,
  ): Promise<StoreRef[]> {
    if (scope !== null && scope.length === 0) return [];
    let query = trx
      .selectFrom('stores')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .where('status', '=', 'active');
    if (scope !== null) query = query.where('id', 'in', [...scope]);
    return query.orderBy('name').orderBy('id').execute();
  }

  async prices(
    trx: TenantTransaction,
    tenantId: string,
    productIds: readonly string[],
    storeIds: readonly string[],
  ): Promise<PriceCell[]> {
    if (productIds.length === 0 || storeIds.length === 0) return [];
    return trx
      .selectFrom('storeProducts')
      .select([
        'productId',
        'storeId',
        'retailPricePerPackDirams as priceDirams',
      ])
      .where('tenantId', '=', tenantId)
      .where('productId', 'in', [...productIds])
      .where('storeId', 'in', [...storeIds])
      .execute();
  }

  /** The current prices of one product at the stores, locked until the transaction ends. */
  async lockPrices(
    trx: TenantTransaction,
    tenantId: string,
    productId: string,
    storeIds: readonly string[],
  ): Promise<Map<string, bigint | null>> {
    const result = await sql<{ storeId: string; price: bigint | null }>`
      select store_id, retail_price_per_pack_dirams as price from pharmacy.store_products
      where tenant_id = ${tenantId} and product_id = ${productId}
        and store_id in (${sql.join([...storeIds])})
      for update`.execute(trx);
    return new Map(result.rows.map((row) => [row.storeId, row.price]));
  }

  async setPrice(
    trx: TenantTransaction,
    tenantId: string,
    productId: string,
    storeId: string,
    priceDirams: number,
    employeeId: string,
  ): Promise<void> {
    await sql`
      insert into pharmacy.store_products
        (tenant_id, store_id, product_id, retail_price_per_pack_dirams,
         price_changed_at, price_changed_by, price_source)
      values (${tenantId}, ${storeId}, ${productId}, ${BigInt(priceDirams)},
              now(), ${employeeId}, 'cloud')
      on conflict (tenant_id, store_id, product_id) do update set
        retail_price_per_pack_dirams = excluded.retail_price_per_pack_dirams,
        price_version = pharmacy.store_products.price_version + 1,
        price_changed_at = excluded.price_changed_at,
        price_changed_by = excluded.price_changed_by,
        price_source = 'cloud',
        updated_at = now()`.execute(trx);
  }

  /** Rules of the network, or of one id; with their store ids, tiers and author. */
  async rules(
    trx: TenantTransaction,
    tenantId: string,
    id: string | null,
  ): Promise<RuleRow[]> {
    const result = await sql<RuleRow>`
      select r.id, r.name, r.level, r.valid_from::text as valid_from,
             r.valid_to::text as valid_to, r.created_at,
             e.full_name as author_name, ro.name as author_role
      from pharmacy.discount_rules r
      join pharmacy.employees e on e.tenant_id = r.tenant_id and e.id = r.created_by
      join pharmacy.roles ro on ro.tenant_id = e.tenant_id and ro.id = e.role_id
      where r.tenant_id = ${tenantId} and r.status = 'active'
        ${id === null ? sql`` : sql`and r.id = ${id}`}
      order by r.created_at desc, r.id`.execute(trx);
    return result.rows;
  }

  async ruleStores(
    trx: TenantTransaction,
    tenantId: string,
    ruleIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (ruleIds.length === 0) return map;
    const rows = await trx
      .selectFrom('discountRuleStores')
      .select(['ruleId', 'storeId'])
      .where('tenantId', '=', tenantId)
      .where('ruleId', 'in', [...ruleIds])
      .execute();
    for (const row of rows)
      map.set(row.ruleId, [...(map.get(row.ruleId) ?? []), row.storeId]);
    return map;
  }

  async ruleTiers(
    trx: TenantTransaction,
    tenantId: string,
    ruleIds: readonly string[],
  ): Promise<
    Map<string, Array<{ minTotalDirams: bigint; percentBp: number }>>
  > {
    const map = new Map<
      string,
      Array<{ minTotalDirams: bigint; percentBp: number }>
    >();
    if (ruleIds.length === 0) return map;
    const rows = await trx
      .selectFrom('discountRuleTiers')
      .select(['ruleId', 'minTotalDirams', 'percentBp'])
      .where('tenantId', '=', tenantId)
      .where('ruleId', 'in', [...ruleIds])
      .orderBy('minTotalDirams')
      .execute();
    for (const row of rows) {
      map.set(row.ruleId, [
        ...(map.get(row.ruleId) ?? []),
        { minTotalDirams: row.minTotalDirams, percentBp: row.percentBp },
      ]);
    }
    return map;
  }

  async insertRule(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    createdBy: string,
    values: RuleValues,
  ): Promise<void> {
    await trx
      .insertInto('discountRules')
      .values({
        tenantId,
        id,
        createdBy,
        name: JSON.stringify(values.name),
        level: values.storeIds === null ? 'network' : 'store',
        storeScope: values.storeIds === null ? 'all' : 'list',
        validFrom: values.validFrom,
        validTo: values.validTo,
      })
      .execute();
    await this.replaceParts(trx, tenantId, id, values);
  }

  async updateRule(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    values: RuleValues,
  ): Promise<void> {
    await trx
      .updateTable('discountRules')
      .set({
        name: JSON.stringify(values.name),
        level: values.storeIds === null ? 'network' : 'store',
        storeScope: values.storeIds === null ? 'all' : 'list',
        validFrom: values.validFrom,
        validTo: values.validTo,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await this.replaceParts(trx, tenantId, id, values);
  }

  /** Locks the rule row so that two edits of one rule apply one after the other. */
  async lockRule(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const result = await sql`
      select 1 from pharmacy.discount_rules
      where tenant_id = ${tenantId} and id = ${id} and status = 'active' for update`.execute(
      trx,
    );
    return result.rows.length > 0;
  }

  private async replaceParts(
    trx: TenantTransaction,
    tenantId: string,
    ruleId: string,
    values: RuleValues,
  ): Promise<void> {
    await trx
      .deleteFrom('discountRuleTiers')
      .where('tenantId', '=', tenantId)
      .where('ruleId', '=', ruleId)
      .execute();
    await trx
      .deleteFrom('discountRuleStores')
      .where('tenantId', '=', tenantId)
      .where('ruleId', '=', ruleId)
      .execute();
    await trx
      .insertInto('discountRuleTiers')
      .values(
        values.tiers.map((tier) => ({
          tenantId,
          ruleId,
          minTotalDirams: BigInt(tier.minTotalDirams),
          percentBp: tier.percentBp,
        })),
      )
      .execute();
    if (values.storeIds !== null && values.storeIds.length > 0) {
      await trx
        .insertInto('discountRuleStores')
        .values(
          values.storeIds.map((storeId) => ({ tenantId, ruleId, storeId })),
        )
        .execute();
    }
  }
}
