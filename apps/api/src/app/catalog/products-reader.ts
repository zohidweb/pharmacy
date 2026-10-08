import { Injectable } from '@nestjs/common';
import { requirePrincipal } from '../../common/context/request-context';
import type { TenantTransaction } from '../../core/database';
import { CatalogRepository, localizedName, type ProductRow } from './catalog.repository';

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
    const byId = new Map((await this.toPricing(trx, tenantId, rows)).map((p) => [p.id, p]));
    return {
      items: ids.flatMap((id) => {
        const product = byId.get(id);
        return product ? [product] : [];
      }),
      total,
    };
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
        row.maxRetailPricePerPackDirams === null ? null : Number(row.maxRetailPricePerPackDirams),
      markupBp: row.markupBp,
      categoryMarkupBp: row.categoryMarkupBp,
    }));
  }
}
