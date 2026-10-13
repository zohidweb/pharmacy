import { Injectable } from '@nestjs/common';
import { countries } from '@pharmacy/shared-domain';
import { requirePrincipal } from '../../common/context/request-context';
import type { TenantTransaction } from '../../core/database';
import {
  CatalogRepository,
  localizedName,
  type ProductRow,
} from './catalog.repository';

/** A product as the POS snapshot sees it (spec 2026-10-13-pos-shift-sale, 4.3). */
export interface PosCatalogProduct {
  id: string;
  /** In the session language, else the default language of the network. */
  name: string;
  inn: string | null;
  manufacturer: string;
  /** Country name in the session language. */
  country: string;
  form: string;
  categoryId: string;
  barcodes: string[];
  piecesPerPack: number;
  divisible: boolean;
  prescription: 'none' | 'rx' | 'controlled';
  status: 'active' | 'archived';
}

/** A product as the stock module sees it. */
export interface StockProduct {
  id: string;
  name: string;
  barcodes: string[];
  categoryId: string;
  prescription: 'none' | 'rx' | 'controlled';
  piecesPerPack: number;
  divisible: boolean;
  /** Default minimum stock of the product, pieces. */
  minStockPieces: number;
  status: 'active' | 'archived';
  markupBp: number | null;
  categoryMarkupBp: number | null;
  maxPriceMinor: number | null;
}

/** A product as the pricing module sees it. */
export interface PricingProduct {
  id: string;
  /** In the session language, else the default language of the network. */
  name: string;
  status: 'active' | 'archived';
  piecesPerPack: number;
  maxPriceMinor: number | null;
  markupBp: number | null;
  categoryMarkupBp: number | null;
}

// The public interface of the catalog module (ADR-0002): other modules read products through it,
// never the catalog tables. Runs inside the caller's tenant transaction.
@Injectable()
export class ProductsReader {
  constructor(private readonly repository: CatalogRepository) {}

  async findForPricing(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<PricingProduct[]> {
    const rows = await this.repository.findProducts(trx, tenantId, ids);
    return this.toPricing(trx, tenantId, rows);
  }

  /** A page of active products in the order of the catalog list. */
  async listForPricing(
    trx: TenantTransaction,
    tenantId: string,
    query: { q?: string; categoryId?: string; limit: number; offset: number },
  ): Promise<{ items: PricingProduct[]; total: number }> {
    const language = await this.repository.networkLanguage(trx, tenantId);
    const { ids, total } = await this.repository.listProductIds(
      trx,
      tenantId,
      { q: query.q, categoryId: query.categoryId, status: 'active' },
      { limit: query.limit, offset: query.offset },
      language,
    );
    const rows = await this.repository.findProducts(trx, tenantId, ids);
    const byId = new Map(
      (await this.toPricing(trx, tenantId, rows)).map((p) => [p.id, p]),
    );
    return {
      items: ids.flatMap((id) => {
        const product = byId.get(id);
        return product ? [product] : [];
      }),
      total,
    };
  }

  async findForStock(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<StockProduct[]> {
    const { locale } = requirePrincipal();
    const language = await this.repository.networkLanguage(trx, tenantId);
    const rows = await this.repository.findProducts(trx, tenantId, ids);
    return rows.map((row) => ({
      id: row.id,
      name: localizedName(row.name, locale, language),
      barcodes: row.barcodes,
      categoryId: row.categoryId,
      prescription: row.isControlled
        ? 'controlled'
        : row.isPrescription
          ? 'rx'
          : 'none',
      piecesPerPack: row.piecesPerPack,
      divisible: row.soldByPiece,
      minStockPieces: row.defaultMinStockPieces ?? 0,
      status: row.status === 'archived' ? 'archived' : 'active',
      markupBp: row.markupBp,
      categoryMarkupBp: row.categoryMarkupBp,
      maxPriceMinor:
        row.maxRetailPricePerPackDirams === null
          ? null
          : Number(row.maxRetailPricePerPackDirams),
    }));
  }

  /**
   * A category of the network in the session language with the ids of its products (any
   * status) — the scope of a stock count; null for an unknown category.
   */
  async category(
    trx: TenantTransaction,
    tenantId: string,
    categoryId: string,
  ): Promise<{ id: string; name: string; productIds: string[] } | null> {
    const row = await this.repository.findCategory(trx, tenantId, categoryId);
    if (row === null) return null;
    const { locale } = requirePrincipal();
    const language = await this.repository.networkLanguage(trx, tenantId);
    return {
      id: row.id,
      name: localizedName(row.name, locale, language),
      productIds: await this.repository.productIdsOfCategory(
        trx,
        tenantId,
        row.id,
      ),
    };
  }

  /** Products of the POS snapshot: all active ones, or the given ids in any status. */
  async listForPos(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[] | null,
  ): Promise<PosCatalogProduct[]> {
    const { locale } = requirePrincipal();
    const language = await this.repository.networkLanguage(trx, tenantId);
    const rows = await this.repository.posProducts(trx, tenantId, ids);
    return rows.map((row) => {
      const inn = localizedName(row.inn, locale, language);
      const country = countries.find((c) => c.code === row.country);
      return {
        id: row.id,
        name: localizedName(row.name, locale, language),
        inn: inn === '' ? null : inn,
        manufacturer: row.manufacturer ?? '',
        country: country
          ? locale === 'tg'
            ? country.name.tj
            : country.name.ru
          : (row.country ?? ''),
        form: row.dosageForm ?? '',
        categoryId: row.categoryId,
        barcodes: row.barcodes,
        piecesPerPack: row.piecesPerPack,
        divisible: row.soldByPiece,
        prescription: row.isControlled
          ? 'controlled'
          : row.isPrescription
            ? 'rx'
            : 'none',
        status: row.status === 'archived' ? 'archived' : 'active',
      };
    });
  }

  /** Products changed after a moment: still active ones and the archived ones. */
  async changedSince(
    trx: TenantTransaction,
    tenantId: string,
    since: Date,
  ): Promise<{ changed: string[]; archived: string[] }> {
    const rows = await this.repository.productsChangedSince(trx, tenantId, since);
    return {
      changed: rows.filter((r) => r.status !== 'archived').map((r) => r.id),
      archived: rows.filter((r) => r.status === 'archived').map((r) => r.id),
    };
  }

  /** Active categories in the POS order, names in the session language. */
  async categoriesForPos(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const { locale } = requirePrincipal();
    const language = await this.repository.networkLanguage(trx, tenantId);
    const rows = await this.repository.listCategories(trx, tenantId, true);
    return rows.map((row) => ({
      id: row.id,
      name: localizedName(row.name, locale, language),
    }));
  }

  /** Active products with a default minimum stock (the deficit of a purchase order). */
  async withMinStock(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<StockProduct[]> {
    return this.findForStock(
      trx,
      tenantId,
      await this.repository.minStockProductIds(trx, tenantId),
    );
  }

  /** Ids of the products the catalog search finds (any status); null — no search. */
  async searchIds(
    trx: TenantTransaction,
    tenantId: string,
    q: string | undefined,
  ): Promise<string[] | null> {
    if (!q?.trim()) return null;
    const language = await this.repository.networkLanguage(trx, tenantId);
    const { ids } = await this.repository.listProductIds(
      trx,
      tenantId,
      { q },
      { limit: 1000, offset: 0 },
      language,
    );
    return ids;
  }

  private async toPricing(
    trx: TenantTransaction,
    tenantId: string,
    rows: ProductRow[],
  ): Promise<PricingProduct[]> {
    const { locale } = requirePrincipal();
    const language = await this.repository.networkLanguage(trx, tenantId);
    return rows.map((row) => ({
      id: row.id,
      name: localizedName(row.name, locale, language),
      status: row.status === 'archived' ? 'archived' : 'active',
      piecesPerPack: row.piecesPerPack,
      maxPriceMinor:
        row.maxRetailPricePerPackDirams === null
          ? null
          : Number(row.maxRetailPricePerPackDirams),
      markupBp: row.markupBp,
      categoryMarkupBp: row.categoryMarkupBp,
    }));
  }
}
