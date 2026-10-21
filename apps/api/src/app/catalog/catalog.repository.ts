import { Injectable } from '@nestjs/common';
import type { CatalogFlag, CatalogStatus } from '@pharmacy/shared-dto';
import { type Expression, type SqlBool, sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';
import { SyncChanges } from '../../core/sync';

/** Language keys of a name map (data model D6); the UI locale `tg` is the key `tj`. */
export type NameLanguage = 'ru' | 'tj';
export type NameMap = Partial<Record<NameLanguage, string>>;

/** `%`, `_` and `\` of user input match themselves in LIKE (the default escape is `\`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function stringAt(name: unknown, key: NameLanguage): string | null {
  if (typeof name !== 'object' || name === null) return null;
  const value = (name as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The name in the session language, else in the default language of the network, else any. */
export function localizedName(
  name: unknown,
  locale: 'ru' | 'tg',
  fallback: NameLanguage,
): string {
  return (
    stringAt(name, locale === 'tg' ? 'tj' : 'ru') ??
    stringAt(name, fallback) ??
    stringAt(name, 'ru') ??
    stringAt(name, 'tj') ??
    ''
  );
}

/** A name map without empty languages. */
export function nameMap(ru: string, tj: string): NameMap {
  return { ...(ru ? { ru } : {}), ...(tj ? { tj } : {}) };
}

export const nameOf = (name: unknown, key: NameLanguage): string =>
  stringAt(name, key) ?? '';

export interface ProductRow {
  id: string;
  name: unknown;
  inn: unknown;
  dosageForm: string | null;
  dosage: string | null;
  manufacturer: string | null;
  country: string | null;
  unit: string;
  piecesPerPack: number;
  soldByPiece: boolean;
  isPrescription: boolean;
  isControlled: boolean;
  maxRetailPricePerPackDirams: bigint | null;
  categoryId: string;
  categoryName: unknown;
  categoryMarkupBp: number | null;
  markupBp: number | null;
  defaultMinStockPieces: number | null;
  status: string;
  barcodes: string[];
}

export interface ProductListRow {
  id: string;
  name: unknown;
  inn: unknown;
  barcode: string | null;
  barcodeCount: number;
  categoryName: unknown;
  dosageForm: string | null;
  manufacturer: string | null;
  unit: string;
  piecesPerPack: number;
  isPrescription: boolean;
  isControlled: boolean;
  isPriceRegulated: boolean;
  status: string;
  priceDirams: bigint | null;
}

export interface ProductFilter {
  q?: string;
  categoryId?: string;
  form?: string;
  flag?: CatalogFlag;
  /** Without it — every status (the stock still lists archived products with stock). */
  status?: CatalogStatus;
  /** Only these products (the price problems, spec 2026-10-15-nav-counters). */
  ids?: readonly string[];
}

/** Columns of a product as written by the catalog (barcodes are written separately). */
export interface ProductValues {
  name: NameMap;
  inn: NameMap | null;
  dosageForm: string | null;
  dosage: string | null;
  manufacturer: string | null;
  country: string | null;
  unit: string;
  piecesPerPack: number;
  soldByPiece: boolean;
  isPrescription: boolean;
  isControlled: boolean;
  isPriceRegulated: boolean;
  maxRetailPricePerPackDirams: number | null;
  categoryId: string;
  markupBp: number | null;
  defaultMinStockPieces: number | null;
}

export interface CategoryRow {
  id: string;
  name: unknown;
  markupBp: number | null;
  status: string;
  products: number;
}

const BARCODE = /^[0-9]{8,14}$/;
/** Rows of one multi-row insert of a file load: well below the parameters of a statement. */
const BULK_ROWS = 1_000;

// Data access of the catalog (spec 2026-10-07-catalog-pricing, section 5): products, barcodes,
// categories and dosage forms of one network. RLS keeps every query inside the tenant; the
// tenant_id conditions keep the plans on the tenant-leading indexes.
@Injectable()
export class CatalogRepository {
  // every write of products, barcodes and categories records its entity in the change feed (spec
  // 2026-10-16-offline-sync, E4) — in the repository, so that no path of writing misses it
  constructor(private readonly feed: SyncChanges) {}

  async networkLanguage(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<NameLanguage> {
    const row = await trx
      .selectFrom('tenantSettings')
      .select('defaultLanguage')
      .where('tenantId', '=', tenantId)
      .executeTakeFirst();
    return row?.defaultLanguage === 'tj' ? 'tj' : 'ru';
  }

  /** The search, filter and status conditions of the product list and of the price list. */
  productConditions(
    tenantId: string,
    filter: ProductFilter,
  ): Expression<SqlBool> {
    const parts = [sql`p.tenant_id = ${tenantId}`];
    if (filter.status) parts.push(sql`p.status = ${filter.status}`);
    if (filter.ids) {
      parts.push(
        filter.ids.length === 0
          ? sql`false`
          : sql`p.id = any(${sql.val([...filter.ids])}::uuid[])`,
      );
    }
    const q = filter.q?.trim() ?? '';
    if (q !== '') {
      const pattern = `%${escapeLike(q.toLocaleLowerCase('ru'))}%`;
      const byText = sql`(lower(p.name ->> 'ru') like ${pattern}
        or lower(p.name ->> 'tj') like ${pattern}
        or lower(p.inn ->> 'ru') like ${pattern})`;
      parts.push(
        BARCODE.test(q)
          ? sql`(${byText} or exists (select 1 from pharmacy.product_barcodes b
              where b.tenant_id = p.tenant_id and b.product_id = p.id and b.barcode = ${q}))`
          : byText,
      );
    }
    if (filter.categoryId)
      parts.push(sql`p.category_id = ${filter.categoryId}`);
    if (filter.form) parts.push(sql`p.dosage_form = ${filter.form}`);
    switch (filter.flag) {
      case 'rx':
        parts.push(sql`p.is_prescription and not p.is_controlled`);
        break;
      case 'controlled':
        parts.push(sql`p.is_controlled`);
        break;
      case 'regulated':
        parts.push(sql`p.is_price_regulated`);
        break;
      case 'no_barcode':
        parts.push(sql`not exists (select 1 from pharmacy.product_barcodes b
          where b.tenant_id = p.tenant_id and b.product_id = p.id)`);
        break;
    }
    return sql<SqlBool>`${sql.join(parts, sql` and `)}`;
  }

  async listProducts(
    trx: TenantTransaction,
    tenantId: string,
    filter: ProductFilter,
    page: { limit: number; offset: number },
    sortLanguage: NameLanguage,
    storeId: string | null,
  ): Promise<{ rows: ProductListRow[]; total: number }> {
    const result = await sql<ProductListRow & { total: bigint }>`
      select p.id, p.name, p.inn, p.dosage_form, p.manufacturer, p.unit, p.pieces_per_pack,
             p.is_prescription, p.is_controlled, p.is_price_regulated, p.status,
             c.name as category_name,
             (select min(b.barcode) from pharmacy.product_barcodes b
               where b.tenant_id = p.tenant_id and b.product_id = p.id) as barcode,
             (select count(*)::integer from pharmacy.product_barcodes b
               where b.tenant_id = p.tenant_id and b.product_id = p.id) as barcode_count,
             sp.retail_price_per_pack_dirams as price_dirams,
             count(*) over () as total
      from pharmacy.products p
      join pharmacy.categories c on c.tenant_id = p.tenant_id and c.id = p.category_id
      left join pharmacy.store_products sp
        on sp.tenant_id = p.tenant_id and sp.product_id = p.id and sp.store_id = ${storeId}
      where ${this.productConditions(tenantId, filter)}
      order by lower(p.name ->> ${sortLanguage}) nulls last, p.id
      limit ${page.limit} offset ${page.offset}`.execute(trx);
    return {
      rows: result.rows,
      total: Number(
        result.rows[0]?.total ?? (await this.count(trx, tenantId, filter)),
      ),
    };
  }

  // An offset past the end returns no rows and no window total: count separately.
  private async count(
    trx: TenantTransaction,
    tenantId: string,
    filter: ProductFilter,
  ): Promise<number> {
    const result = await sql<{ n: number }>`
      select count(*)::integer as n from pharmacy.products p
      where ${this.productConditions(tenantId, filter)}`.execute(trx);
    return result.rows[0]?.n ?? 0;
  }

  async productKpi(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<{ products: number; withoutBarcode: number }> {
    const result = await sql<{ products: number; withoutBarcode: number }>`
      select count(*)::integer as products,
             count(*) filter (where not exists (
               select 1 from pharmacy.product_barcodes b
               where b.tenant_id = p.tenant_id and b.product_id = p.id))::integer as without_barcode
      from pharmacy.products p
      where p.tenant_id = ${tenantId} and p.status = 'active'`.execute(trx);
    return result.rows[0] ?? { products: 0, withoutBarcode: 0 };
  }

  async findProduct(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<ProductRow | null> {
    const rows = await this.findProducts(trx, tenantId, [id]);
    return rows[0] ?? null;
  }

  /** Products of a category, any status. */
  async productIdsOfCategory(
    trx: TenantTransaction,
    tenantId: string,
    categoryId: string,
  ): Promise<string[]> {
    const rows = await trx
      .selectFrom('products')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('categoryId', '=', categoryId)
      .execute();
    return rows.map((r) => r.id);
  }

  /** Active products with a default minimum stock. */
  async minStockProductIds(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<string[]> {
    const rows = await trx
      .selectFrom('products')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('status', '=', 'active')
      .where('defaultMinStockPieces', '>', 0)
      .execute();
    return rows.map((r) => r.id);
  }

  /** The regulated maximum price of a pack of the active products among `ids`; null — not regulated. */
  async activeMaxPrices(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, number | null>> {
    if (ids.length === 0) return new Map();
    const result = await sql<{ id: string; maxPrice: string | null }>`
      select p.id, p.max_retail_price_per_pack_dirams as max_price
      from pharmacy.products p
      where p.tenant_id = ${tenantId} and p.status = 'active'
        and p.id = any(${sql.val([...ids])}::uuid[])`.execute(trx);
    return new Map(
      result.rows.map((row) => [
        row.id,
        row.maxPrice === null ? null : Number(row.maxPrice),
      ]),
    );
  }

  async findProducts(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<ProductRow[]> {
    if (ids.length === 0) return [];
    const result = await sql<ProductRow>`
      select p.id, p.name, p.inn, p.dosage_form, p.dosage, p.manufacturer, p.country, p.unit,
             p.pieces_per_pack, p.sold_by_piece, p.is_prescription, p.is_controlled,
             p.max_retail_price_per_pack_dirams, p.category_id, p.markup_bp,
             p.default_min_stock_pieces, p.status,
             c.name as category_name, c.markup_bp as category_markup_bp,
             coalesce((select array_agg(b.barcode order by b.created_at, b.barcode)
                       from pharmacy.product_barcodes b
                       where b.tenant_id = p.tenant_id and b.product_id = p.id), '{}') as barcodes
      from pharmacy.products p
      join pharmacy.categories c on c.tenant_id = p.tenant_id and c.id = p.category_id
      where p.tenant_id = ${tenantId} and p.id in (${sql.join(ids)})`.execute(
      trx,
    );
    return result.rows;
  }

  /**
   * Products for the POS snapshot (spec 2026-10-13-pos-shift-sale, 4.3): all active ones, or the
   * given ids in any status.
   */
  async posProducts(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[] | null,
  ): Promise<ProductRow[]> {
    if (ids !== null) return this.findProducts(trx, tenantId, ids);
    const result = await sql<{ id: string }>`
      select p.id from pharmacy.products p
      where p.tenant_id = ${tenantId} and p.status = 'active'`.execute(trx);
    return this.findProducts(
      trx,
      tenantId,
      result.rows.map((row) => row.id),
    );
  }

  /** Products changed after a moment (card, barcodes, status): the delta of the POS snapshot. */
  async productsChangedSince(
    trx: TenantTransaction,
    tenantId: string,
    since: Date,
  ): Promise<Array<{ id: string; status: string }>> {
    const result = await sql<{ id: string; status: string }>`
      select p.id, p.status from pharmacy.products p
      where p.tenant_id = ${tenantId} and p.updated_at > ${since}`.execute(trx);
    return result.rows;
  }

  /** Product ids of the page of the price list (active products, the list order). */
  async listProductIds(
    trx: TenantTransaction,
    tenantId: string,
    filter: ProductFilter,
    page: { limit: number; offset: number },
    sortLanguage: NameLanguage,
  ): Promise<{ ids: string[]; total: number }> {
    const result = await sql<{ id: string; total: bigint }>`
      select p.id, count(*) over () as total
      from pharmacy.products p
      where ${this.productConditions(tenantId, filter)}
      order by lower(p.name ->> ${sortLanguage}) nulls last, p.id
      limit ${page.limit} offset ${page.offset}`.execute(trx);
    return {
      ids: result.rows.map((row) => row.id),
      total: Number(
        result.rows[0]?.total ?? (await this.count(trx, tenantId, filter)),
      ),
    };
  }

  async insertProduct(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    values: ProductValues,
  ): Promise<void> {
    await trx
      .insertInto('products')
      .values({ tenantId, id, ...this.columns(values) })
      .execute();
    await this.feed.record(trx, {
      tenantId,
      entityType: 'product',
      entityId: id,
    });
  }

  async updateProduct(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    values: ProductValues,
  ): Promise<void> {
    await trx
      .updateTable('products')
      .set({ ...this.columns(values), updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await this.feed.record(trx, {
      tenantId,
      entityType: 'product',
      entityId: id,
    });
  }

  private columns(values: ProductValues) {
    return {
      ...values,
      name: JSON.stringify(values.name),
      inn: values.inn === null ? null : JSON.stringify(values.inn),
      maxRetailPricePerPackDirams:
        values.maxRetailPricePerPackDirams === null
          ? null
          : BigInt(values.maxRetailPricePerPackDirams),
    };
  }

  async setProductStatus(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    status: CatalogStatus,
  ): Promise<void> {
    await trx
      .updateTable('products')
      .set({
        status,
        archivedAt: status === 'archived' ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await this.feed.record(trx, {
      tenantId,
      entityType: 'product',
      entityId: id,
    });
  }

  /** Barcodes of the list that belong to another product of the network (archived ones too). */
  async takenBarcodes(
    trx: TenantTransaction,
    tenantId: string,
    codes: readonly string[],
    exceptProductId: string | null,
  ): Promise<string[]> {
    if (codes.length === 0) return [];
    let query = trx
      .selectFrom('productBarcodes')
      .select('barcode')
      .where('tenantId', '=', tenantId)
      .where('barcode', 'in', [...codes]);
    if (exceptProductId !== null)
      query = query.where('productId', '<>', exceptProductId);
    return (await query.execute()).map((row) => row.barcode);
  }

  /** The barcodes of the product become exactly `codes`. */
  async replaceBarcodes(
    trx: TenantTransaction,
    tenantId: string,
    productId: string,
    codes: readonly string[],
  ): Promise<void> {
    let removal = trx
      .deleteFrom('productBarcodes')
      .where('tenantId', '=', tenantId)
      .where('productId', '=', productId);
    if (codes.length > 0)
      removal = removal.where('barcode', 'not in', [...codes]);
    const removed = await removal.executeTakeFirst();
    // the barcodes of a product are part of it in the change feed (E4): recorded when they changed
    const changed = Number(removed.numDeletedRows ?? 0) > 0;
    if (codes.length === 0) {
      if (changed) await this.recordProduct(trx, tenantId, productId);
      return;
    }
    const kept = new Set(
      (
        await trx
          .selectFrom('productBarcodes')
          .select('barcode')
          .where('tenantId', '=', tenantId)
          .where('productId', '=', productId)
          .execute()
      ).map((row) => row.barcode),
    );
    // Inserted in one order everywhere: two products adding the same free codes at once wait for
    // each other on the primary key instead of deadlocking (the loser gets barcode_taken).
    const added = codes.filter((code) => !kept.has(code)).sort();
    if (added.length === 0) {
      if (changed) await this.recordProduct(trx, tenantId, productId);
      return;
    }
    await trx
      .insertInto('productBarcodes')
      .values(added.map((barcode) => ({ tenantId, barcode, productId })))
      .execute();
    await this.recordProduct(trx, tenantId, productId);
  }

  private recordProduct(
    trx: TenantTransaction,
    tenantId: string,
    productId: string,
  ): Promise<void> {
    return this.feed.record(trx, {
      tenantId,
      entityType: 'product',
      entityId: productId,
    });
  }

  /** Active dosage forms of the network. */
  async dosageForms(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<unknown[]> {
    const rows = await trx
      .selectFrom('dictionaryValues')
      .select('name')
      .where('tenantId', '=', tenantId)
      .where('kind', '=', 'dosage_form')
      .where('status', '=', 'active')
      .orderBy('createdAt')
      .orderBy('id')
      .execute();
    return rows.map((row) => row.name);
  }

  /** Distinct manufacturers and INNs of the products of the network, for the suggestions. */
  async suggestions(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<{ manufacturers: string[]; inns: string[] }> {
    const manufacturers = await sql<{ value: string }>`
      select distinct manufacturer as value from pharmacy.products
      where tenant_id = ${tenantId} and manufacturer is not null
      order by 1 limit 500`.execute(trx);
    const inns = await sql<{ value: string }>`
      select distinct inn ->> 'ru' as value from pharmacy.products
      where tenant_id = ${tenantId} and inn ->> 'ru' is not null
      order by 1 limit 500`.execute(trx);
    return {
      manufacturers: manufacturers.rows.map((row) => row.value),
      inns: inns.rows.map((row) => row.value),
    };
  }

  async listCategories(
    trx: TenantTransaction,
    tenantId: string,
    onlyActive: boolean,
  ): Promise<CategoryRow[]> {
    const result = await sql<CategoryRow>`
      select c.id, c.name, c.markup_bp, c.status,
             (select count(*)::integer from pharmacy.products p
               where p.tenant_id = c.tenant_id and p.category_id = c.id
                 and p.status = 'active') as products
      from pharmacy.categories c
      where c.tenant_id = ${tenantId} ${onlyActive ? sql`and c.status = 'active'` : sql``}
      order by c.pos_sort_order, c.id`.execute(trx);
    return result.rows;
  }

  /** Names (both languages) of the categories with these ids, any status. */
  async categoryNamesByIds(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<{ id: string; name: NameMap }[]> {
    if (ids.length === 0) return [];
    return trx
      .selectFrom('categories')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...ids])
      .execute() as Promise<{ id: string; name: NameMap }[]>;
  }

  async findCategory(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<CategoryRow | null> {
    const rows = await this.listCategories(trx, tenantId, false);
    return rows.find((row) => row.id === id) ?? null;
  }

  async insertCategory(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    name: NameMap,
  ): Promise<void> {
    await sql`
      insert into pharmacy.categories (tenant_id, id, name, pos_sort_order)
      select ${tenantId}, ${id}, ${JSON.stringify(name)}::jsonb,
             coalesce(max(pos_sort_order), 0) + 1
      from pharmacy.categories where tenant_id = ${tenantId}`.execute(trx);
    await this.feed.record(trx, {
      tenantId,
      entityType: 'category',
      entityId: id,
    });
  }

  async renameCategory(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    name: NameMap,
  ): Promise<void> {
    await trx
      .updateTable('categories')
      .set({ name: JSON.stringify(name), updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await this.feed.record(trx, {
      tenantId,
      entityType: 'category',
      entityId: id,
    });
  }

  async setCategoryStatus(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    status: CatalogStatus,
  ): Promise<void> {
    await trx
      .updateTable('categories')
      .set({
        status,
        archivedAt: status === 'archived' ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await this.feed.record(trx, {
      tenantId,
      entityType: 'category',
      entityId: id,
    });
  }

  /**
   * Locks the category row so that an archive and a product written into it do not race: the
   * archive takes it for update, a product write for share, so product writes of one category do
   * not queue behind each other.
   */
  async lockCategory(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    mode: 'update' | 'share' = 'update',
  ): Promise<{ status: string } | null> {
    const row = await sql<{ status: string }>`
      select status from pharmacy.categories
      where tenant_id = ${tenantId} and id = ${id}
      ${sql.raw(mode === 'share' ? 'for share' : 'for update')}`.execute(trx);
    return row.rows[0] ?? null;
  }

  /**
   * Locks the product row before it is read and changed, so that two edits, or an edit and an
   * archive, apply one after the other. FOR NO KEY UPDATE: rows referencing the product (barcodes,
   * prices, batches, document lines) are still inserted meanwhile, their foreign key check takes
   * FOR KEY SHARE. Locked before its category (product, then category).
   */
  async lockProduct(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<{ status: string; mergedIntoProductId: string | null } | null> {
    const row = await sql<{
      status: string;
      mergedIntoProductId: string | null;
    }>`
      select status, merged_into_product_id from pharmacy.products
      where tenant_id = ${tenantId} and id = ${id} for no key update`.execute(
      trx,
    );
    return row.rows[0] ?? null;
  }

  /**
   * Serialises the category name checks of the network until the commit: two writes with the same
   * new name cannot both find it free (names are compared in code across languages).
   */
  async lockCategoryNames(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`category-names:${tenantId}`}, 0))`.execute(
      trx,
    );
  }

  async setMarkups(
    trx: TenantTransaction,
    tenantId: string,
    markups: ReadonlyArray<{ categoryId: string; markupBp: number }>,
  ): Promise<void> {
    // Rows are updated in one order everywhere: two saves at once wait instead of deadlocking.
    const ordered = [...markups].sort((a, b) =>
      a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0,
    );
    for (const markup of ordered) {
      await trx
        .updateTable('categories')
        .set({ markupBp: markup.markupBp, updatedAt: sql`now()` })
        .where('tenantId', '=', tenantId)
        .where('id', '=', markup.categoryId)
        .execute();
    }
    await this.feed.recordMany(
      trx,
      markups.map((m) => ({
        tenantId,
        entityType: 'category',
        entityId: m.categoryId,
      })),
    );
  }

  /* ---------------- local products of offline stores (spec 2026-10-16-offline-sync, E26, E35) ---------------- */

  async productExists(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom('products')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  async categoryExists(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom('categories')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** A card created at an offline store: `origin = local`, its store and the store's time of creation. */
  async insertLocalProduct(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    values: ProductValues,
    storeId: string,
    createdAt: Date,
  ): Promise<void> {
    await trx
      .insertInto('products')
      .values({
        tenantId,
        id,
        ...this.columns(values),
        origin: 'local',
        createdAtStoreId: storeId,
        createdAt,
        updatedAt: createdAt,
      })
      .execute();
    await this.feed.record(trx, {
      tenantId,
      entityType: 'product',
      entityId: id,
    });
  }

  /** The products the barcodes already belong to: barcode → product id. */
  async barcodeOwners(
    trx: TenantTransaction,
    tenantId: string,
    codes: readonly string[],
  ): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await trx
      .selectFrom('productBarcodes')
      .select(['barcode', 'productId'])
      .where('tenantId', '=', tenantId)
      .where('barcode', 'in', [...codes])
      .execute();
    return new Map(rows.map((row) => [row.barcode, row.productId]));
  }

  /**
   * The products that hold these barcodes, archived ones too (spec 2026-10-20-data-import, F8, F9). One array
   * parameter: a file holds up to 20 000 rows of up to 20 codes, past the 65 535 parameters of a statement.
   */
  async barcodeOwnersOf(
    trx: TenantTransaction,
    tenantId: string,
    codes: readonly string[],
  ): Promise<
    Map<string, { productId: string; name: unknown; status: CatalogStatus }>
  > {
    if (codes.length === 0) return new Map();
    const result = await sql<{
      barcode: string;
      productId: string;
      name: unknown;
      status: CatalogStatus;
    }>`
      select b.barcode, b.product_id, p.name, p.status
      from pharmacy.product_barcodes b
      join pharmacy.products p on p.tenant_id = b.tenant_id and p.id = b.product_id
      where b.tenant_id = ${tenantId} and b.barcode = any(${[...codes]}::text[])`.execute(
      trx,
    );
    return new Map(
      result.rows.map((row) => [
        row.barcode,
        { productId: row.productId, name: row.name, status: row.status },
      ]),
    );
  }

  /** Every product of the network with its name, form and dosage: rows of a file without a barcode match by them. */
  async productNameIndex(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<
    {
      id: string;
      name: unknown;
      dosageForm: string | null;
      dosage: string | null;
      status: CatalogStatus;
    }[]
  > {
    const rows = await trx
      .selectFrom('products')
      .select(['id', 'name', 'dosageForm', 'dosage', 'status'])
      .where('tenantId', '=', tenantId)
      .execute();
    return rows.map((row) => ({ ...row, status: row.status as CatalogStatus }));
  }

  /** New products of a file load, 1 000 rows a statement. */
  async insertProducts(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly { id: string; values: ProductValues }[],
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += BULK_ROWS) {
      await trx
        .insertInto('products')
        .values(
          rows
            .slice(i, i + BULK_ROWS)
            .map((row) => ({
              tenantId,
              id: row.id,
              ...this.columns(row.values),
            })),
        )
        .execute();
    }
  }

  /** Barcodes of new products of a file load, in the one order of `replaceBarcodes`. */
  async insertBarcodes(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly { productId: string; barcode: string }[],
  ): Promise<void> {
    const sorted = [...rows].sort((a, b) =>
      a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0,
    );
    for (let i = 0; i < sorted.length; i += BULK_ROWS) {
      await trx
        .insertInto('productBarcodes')
        .values(
          sorted
            .slice(i, i + BULK_ROWS)
            .map((row) => ({
              tenantId,
              barcode: row.barcode,
              productId: row.productId,
            })),
        )
        .execute();
    }
  }

  /**
   * An active card of the network with the same INN (ru), dosage form, dosage and manufacturer (spec E26),
   * the oldest first; null — none, or one of the four is empty.
   */
  async findNameTwin(
    trx: TenantTransaction,
    tenantId: string,
    productId: string,
    values: ProductValues,
  ): Promise<string | null> {
    const inn = values.inn?.ru?.trim();
    const form = values.dosageForm?.trim();
    const dosage = values.dosage?.trim();
    const manufacturer = values.manufacturer?.trim();
    if (!inn || !form || !dosage || !manufacturer) return null;
    const result = await sql<{ id: string }>`
      select id from pharmacy.products
      where tenant_id = ${tenantId} and id <> ${productId}
        and status = 'active' and merged_into_product_id is null
        and lower(inn ->> 'ru') = lower(${inn})
        and lower(dosage_form) = lower(${form})
        and lower(dosage) = lower(${dosage})
        and lower(manufacturer) = lower(${manufacturer})
      order by created_at, id
      limit 1`.execute(trx);
    return result.rows[0]?.id ?? null;
  }

  /** The status and alias of a card, locked; null — none. */
  async lockMergeState(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<{ status: string; mergedIntoProductId: string | null } | null> {
    const row = await trx
      .selectFrom('products')
      .select(['status', 'mergedIntoProductId'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * The store merged its card into a card of the network (spec E35): the card is archived with the alias, and
   * its barcodes move to the card of the network so that a scan finds the same goods.
   */
  async mergeProduct(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    intoId: string,
    at: Date,
  ): Promise<void> {
    await trx
      .updateTable('products')
      .set({
        status: 'archived',
        archivedAt: at,
        mergedIntoProductId: intoId,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
    await trx
      .updateTable('productBarcodes')
      .set({ productId: intoId })
      .where('tenantId', '=', tenantId)
      .where('productId', '=', id)
      .execute();
    await this.feed.record(trx, {
      tenantId,
      entityType: 'product',
      entityId: id,
    });
    await this.feed.record(trx, {
      tenantId,
      entityType: 'product',
      entityId: intoId,
    });
  }
}
