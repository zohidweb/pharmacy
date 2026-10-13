import { Injectable } from '@nestjs/common';
import { hasPermissions, piecePriceMinor } from '@pharmacy/shared-domain';
import type {
  CatalogSnapshot,
  PosBatch,
  PosProduct,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { ProductsReader } from '../catalog/products-reader';
import { PosStock, type PosBatchRow } from '../inventory/pos-stock';
import { StorePricesReader } from '../pricing/store-prices-reader';
import { PosContext } from './pos-context';
import { PosRepository } from './pos.repository';

/** A delta older than this is answered with the whole snapshot. */
const FULL_AFTER_MS = 24 * 3_600_000;
/** A change committed late (a long transaction) is still caught by the next delta (E16). */
const OVERLAP_MS = 120_000;

/** The text of a `{ ru, tj }` map in the session language, else the network one. */
function textIn(
  value: unknown,
  locale: 'ru' | 'tg',
  fallback: 'ru' | 'tj',
): string {
  if (value === null || typeof value !== 'object') return '';
  const map = value as Record<string, unknown>;
  const pick = (key: string) => {
    const text = map[key];
    return typeof text === 'string' && text !== '' ? text : null;
  };
  return pick(locale === 'tg' ? 'tj' : 'ru') ?? pick(fallback) ?? '';
}

// The snapshot of the catalog and prices of a store for the POS (ADR-0015; spec
// 2026-10-13-pos-shift-sale, 4.3, E16): active products with a pack price at the store, the
// batches with stock, the discount steps of the business day and the receipt header. The version is
// the moment of the answer; a delta returns the products changed since it (card, price, stock).
@Injectable()
export class CatalogSnapshotService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly context: PosContext,
    private readonly repository: PosRepository,
    private readonly products: ProductsReader,
    private readonly prices: StorePricesReader,
    private readonly stock: PosStock,
  ) {}

  async snapshot(
    storeId: string,
    sinceVersion: number | undefined,
  ): Promise<CatalogSnapshot> {
    const principal = requirePrincipal();
    const { tenantId, locale } = principal;
    const id = storeId.toLowerCase();
    this.context.inScope(id);
    const canSeeCost = hasPermissions(
      principal.permissions,
      'finance:view-cost',
    );
    const version = Date.now();
    const full =
      sinceVersion === undefined ||
      sinceVersion > version ||
      version - sinceVersion > FULL_AFTER_MS;
    return this.db.tenantTransaction(async (trx) => {
      const store = await this.context.cloudStore(trx, tenantId, id);
      const settings = await this.repository.settings(trx, tenantId);
      const today = await this.repository.businessDate(
        trx,
        tenantId,
        new Date(),
      );

      let candidates: string[] | null = null;
      const removed = new Set<string>();
      if (!full) {
        const since = new Date((sinceVersion as number) - OVERLAP_MS);
        const catalog = await this.products.changedSince(trx, tenantId, since);
        const repriced = await this.prices.productsRepricedSince(
          trx,
          tenantId,
          id,
          since,
        );
        const moved = await this.stock.productsMovedSince(
          trx,
          tenantId,
          id,
          since,
        );
        catalog.archived.forEach((p) => removed.add(p));
        candidates = [
          ...new Set([...catalog.changed, ...repriced, ...moved]),
        ].filter((p) => !removed.has(p));
      }
      const prices = await this.prices.pricesOfStore(
        trx,
        tenantId,
        id,
        candidates,
      );
      const rows = (
        await this.products.listForPos(
          trx,
          tenantId,
          candidates === null ? [...prices.keys()] : candidates,
        )
      ).filter((p) => {
        // a product is sold at the store while it is active and has a price there
        const sold = p.status === 'active' && prices.has(p.id);
        if (!sold) removed.add(p.id);
        return sold;
      });
      const batches = await this.stock.batchesWithStock(
        trx,
        tenantId,
        id,
        candidates === null ? null : rows.map((p) => p.id),
      );
      const byProduct = new Map<string, PosBatchRow[]>();
      for (const batch of batches) {
        byProduct.set(batch.productId, [
          ...(byProduct.get(batch.productId) ?? []),
          batch,
        ]);
      }
      const products = rows.map((p): PosProduct => {
        const price = prices.get(p.id);
        const pack = price?.packDirams ?? 0;
        return {
          id: p.id,
          name: p.name,
          inn: p.inn,
          manufacturer: p.manufacturer,
          country: p.country,
          form: p.form,
          categoryId: p.categoryId,
          barcodes: p.barcodes,
          piecesPerPack: p.piecesPerPack,
          divisible: p.divisible,
          prescription: p.prescription,
          priceMinor: pack,
          piecePriceMinor:
            p.divisible && p.piecesPerPack > 1
              ? piecePriceMinor(
                  pack,
                  p.piecesPerPack,
                  price?.ownPieceDirams ?? null,
                  settings.pieceStepDirams,
                )
              : null,
          batches: (byProduct.get(p.id) ?? []).map(
            (b): PosBatch => ({
              id: b.id,
              number: b.lotNumber ?? '',
              expiresOn: b.expiryDate,
              quantityPieces: b.stockPieces,
              ...(canSeeCost
                ? { costMinor: Number(b.purchasePricePerPackDirams) }
                : {}),
            }),
          ),
        };
      });
      const tiers = await this.prices.activeTiers(trx, tenantId, id, today);
      return {
        version,
        full,
        products,
        removedProductIds: full ? [] : [...removed],
        categories: await this.products.categoriesForPos(trx, tenantId),
        discountRules: tiers.map((tier) => ({
          id: `${tier.ruleId}:${tier.minSubtotalDirams}`,
          minSubtotalMinor: tier.minSubtotalDirams,
          percent: tier.percent,
        })),
        settings: {
          networkName: settings.networkName,
          storeName: store.name,
          storeAddress: store.address,
          taxId: store.taxId,
          receiptFooter: textIn(
            settings.receiptFooter,
            locale,
            settings.defaultLanguage,
          ),
          returnWindowDays: settings.returnPeriodDays,
        },
      };
    });
  }
}
