import { Injectable } from '@nestjs/common';
import type { CatalogFlag, CatalogStatus } from '@pharmacy/shared-dto';
import { type Expression, type SqlBool, sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

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
  status: CatalogStatus;
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

// Data access of the catalog (spec 2026-10-07-catalog-pricing, section 5): products, barcodes,
// categories and dosage forms of one network. RLS keeps every query inside the tenant; the
// tenant_id conditions keep the plans on the tenant-leading indexes.
@Injectable()
export class CatalogRepository {
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
    const parts = [
      sql`p.tenant_id = ${tenantId}`,
      sql`p.status = ${filter.status}`,
    ];
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
    await removal.execute();
    if (codes.length === 0) return;
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
    const added = codes.filter((code) => !kept.has(code));
    if (added.length === 0) return;
    await trx
      .insertInto('productBarcodes')
      .values(added.map((barcode) => ({ tenantId, barcode, productId })))
      .execute();
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
  }

  /** Locks the category row so that an archive and a new product of it do not race. */
  async lockCategory(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<{ status: string } | null> {
    const row = await sql<{ status: string }>`
      select status from pharmacy.categories
      where tenant_id = ${tenantId} and id = ${id} for update`.execute(trx);
    return row.rows[0] ?? null;
  }

  async setMarkups(
    trx: TenantTransaction,
    tenantId: string,
    markups: ReadonlyArray<{ categoryId: string; markupBp: number }>,
  ): Promise<void> {
    for (const markup of markups) {
      await trx
        .updateTable('categories')
        .set({ markupBp: markup.markupBp, updatedAt: sql`now()` })
        .where('tenantId', '=', tenantId)
        .where('id', '=', markup.categoryId)
        .execute();
    }
  }
}
