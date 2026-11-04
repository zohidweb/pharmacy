import { Injectable } from '@nestjs/common';
import {
  hasPermissions,
  priceWarnings,
  wholesalePriceWarnings,
} from '@pharmacy/shared-domain';
import type {
  PriceHistoryPage,
  PriceHistoryQuery,
  PriceListQuery,
  PriceListResponse,
  PriceRow,
  StorePrice,
  UpdatePricesRequest,
  UpdateWholesalePricesRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { DEFAULT_PAGE_LIMIT } from '../../common/pagination';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { PriceHistory } from '../audit/price-history';
import {
  type PricingProduct,
  ProductsReader,
} from '../catalog/products-reader';
import { PriceProblems } from './price-problems';
import { PricingRepository, type StoreRef } from './pricing.repository';
import { PurchasePrices } from './purchase-prices';
import { StockedProducts } from './stocked-products';
import { StorePriceWriter } from './store-price-writer';

const notFound = () => new ProblemException(404, 'not_found');

/** The session scope as store ids; null — the whole network. */
export const scopeIds = (
  storeScope: 'all' | readonly string[],
): readonly string[] | null => (storeScope === 'all' ? null : storeScope);

const markupPercent = (product: PricingProduct): number | null => {
  const bp = product.markupBp ?? product.categoryMarkupBp;
  return bp === null ? null : bp / 100;
};

// Retail prices of a product at the stores (spec 2026-10-07-catalog-pricing, section 6): a price
// belongs to the pair product × store, no price — not sold there (БЛ 6.2). A store of the scope
// needs pricing:update-store or pricing:update-network, any other store pricing:update-network.
@Injectable()
export class PricesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: PricingRepository,
    private readonly products: ProductsReader,
    private readonly writer: StorePriceWriter,
    private readonly purchasePrices: PurchasePrices,
    private readonly stocked: StockedProducts,
    private readonly problems: PriceProblems,
    private readonly history: PriceHistory,
    private readonly audit: AuditService,
  ) {}

  async list(query: PriceListQuery): Promise<PriceListResponse> {
    const { tenantId, storeScope, permissions } = requirePrincipal();
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = query.offset ?? 0;
    const scope = scopeIds(storeScope);
    const storeId = query.storeId?.toLowerCase();
    if (storeId && scope !== null && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    return this.db.tenantTransaction(async (trx) => {
      const stores = await this.repository.activeStores(trx, tenantId, scope);
      // «Только с проблемами» (spec 2026-10-15-nav-counters, E8): at the pharmacy `storeId`, else at
      // any pharmacy of the scope — the rule of the menu counter
      const productIds = query.problems
        ? await this.problems.productIds(
            trx,
            tenantId,
            stores
              .filter(
                (store) =>
                  store.kind === 'pharmacy' &&
                  (!storeId || store.id === storeId),
              )
              .map((store) => store.id),
            hasPermissions(permissions, 'finance:view-cost'),
          )
        : undefined;
      const page = await this.products.listForPricing(trx, tenantId, {
        q: query.q,
        categoryId: query.categoryId,
        productIds,
        limit,
        offset,
      });
      const rows = await this.rows(trx, tenantId, page.items, stores);
      return {
        items: rows,
        total: page.total,
        limit,
        offset,
        stores: stores.map((store) => ({ id: store.id, name: store.name })),
      };
    });
  }

  async ofProduct(productId: string): Promise<StorePrice[]> {
    const { tenantId, storeScope } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const [product] = await this.products.findForPricing(trx, tenantId, [
        productId.toLowerCase(),
      ]);
      if (!product) throw notFound();
      const stores = await this.repository.activeStores(
        trx,
        tenantId,
        scopeIds(storeScope),
      );
      const [row] = await this.rows(trx, tenantId, [product], stores);
      return row.prices;
    });
  }

  /**
   * The changes of the prices of a product at the stores of the scope, the newest first (spec
   * 2026-11-03-pos-store-ideas, D14–D16). A store outside the scope — 403 `store_not_in_scope`; the closed stores of
   * the scope stay in the history.
   */
  async priceHistory(
    productId: string,
    query: PriceHistoryQuery,
  ): Promise<PriceHistoryPage> {
    const { tenantId, storeScope } = requirePrincipal();
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = query.offset ?? 0;
    const scope = scopeIds(storeScope);
    const storeId = query.storeId?.toLowerCase();
    if (storeId && scope !== null && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    return this.db.tenantTransaction(async (trx) => {
      const [product] = await this.products.findForPricing(trx, tenantId, [
        productId.toLowerCase(),
      ]);
      if (!product) throw notFound();
      const storeIds = storeId ? [storeId] : scope;
      if (storeIds !== null && storeIds.length === 0) {
        return { items: [], total: 0, limit, offset };
      }
      return this.history.page(trx, {
        tenantId,
        productId: product.id,
        storeIds,
        limit,
        offset,
      });
    });
  }

  async update(
    productId: string,
    request: UpdatePricesRequest,
  ): Promise<PriceRow> {
    const { tenantId, storeScope, permissions } = requirePrincipal();
    const network = hasPermissions(permissions, 'pricing:update-network');
    if (!network && !hasPermissions(permissions, 'pricing:update-store')) {
      throw new ProblemException(403, 'forbidden');
    }
    const id = productId.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const [product] = await this.products.findForPricing(trx, tenantId, [id]);
      if (!product) throw notFound();
      if (product.status === 'archived')
        throw new ProblemException(409, 'product_archived');

      const wanted = request.prices.map((price) => ({
        storeId: price.storeId.toLowerCase(),
        priceMinor: price.priceMinor,
      }));
      const active = new Set(
        (await this.repository.activeStores(trx, tenantId, null)).map(
          (store) => store.id,
        ),
      );
      if (wanted.some((price) => !active.has(price.storeId))) throw notFound();
      // Nothing is written when any store of the request is outside the editor's rights.
      const scope = scopeIds(storeScope);
      if (
        !network &&
        scope !== null &&
        wanted.some((price) => !scope.includes(price.storeId))
      ) {
        throw new ProblemException(403, 'store_not_in_scope');
      }
      const max = product.maxPriceMinor;
      if (
        !request.confirmAboveMax &&
        max !== null &&
        wanted.some((price) => price.priceMinor > max)
      ) {
        throw new FieldProblemException(422, 'above_max_price', [
          { field: 'prices', code: 'above_max_price' },
        ]);
      }

      // the stores in one order (store, product), as every writer of prices: no deadlock
      const ordered = [...wanted].sort((a, b) =>
        a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0,
      );
      for (const price of ordered) {
        await this.writer.set(trx, {
          tenantId,
          productId: id,
          storeId: price.storeId,
          priceMinor: price.priceMinor,
          maxPriceMinor: max,
          confirmAboveMax: request.confirmAboveMax,
          field: 'prices',
          source: 'prices',
        });
      }
      const stores = await this.repository.activeStores(trx, tenantId, scope);
      const [row] = await this.rows(trx, tenantId, [product], stores);
      return row;
    });
  }

  /**
   * Wholesale prices of a pack of a product at the stores (spec 2026-11-03-pos-store-ideas, D19–D21; plan
   * 2026-11-03-pos-store-ideas-pr3, R2, R3): the rights, the regulated maximum and the order of the locks of
   * `update`; only next to a retail price of the store (422 `no_retail_price`); null closes the wholesale. An equal
   * price writes nothing; a change — `wholesale_price.changed` in the audit log.
   */
  async updateWholesale(
    productId: string,
    request: UpdateWholesalePricesRequest,
  ): Promise<StorePrice[]> {
    const { tenantId, storeScope, permissions } = requirePrincipal();
    const network = hasPermissions(permissions, 'pricing:update-network');
    if (!network && !hasPermissions(permissions, 'pricing:update-store')) {
      throw new ProblemException(403, 'forbidden');
    }
    const id = productId.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const [product] = await this.products.findForPricing(trx, tenantId, [id]);
      if (!product) throw notFound();
      if (product.status === 'archived')
        throw new ProblemException(409, 'product_archived');

      const wanted = request.prices.map((price) => ({
        storeId: price.storeId.toLowerCase(),
        priceMinor: price.priceMinor,
      }));
      const active = new Set(
        (await this.repository.activeStores(trx, tenantId, null)).map(
          (store) => store.id,
        ),
      );
      if (wanted.some((price) => !active.has(price.storeId))) throw notFound();
      // Nothing is written when any store of the request is outside the editor's rights.
      const scope = scopeIds(storeScope);
      if (
        !network &&
        scope !== null &&
        wanted.some((price) => !scope.includes(price.storeId))
      ) {
        throw new ProblemException(403, 'store_not_in_scope');
      }
      const max = product.maxPriceMinor;
      if (
        !request.confirmAboveMax &&
        max !== null &&
        wanted.some(
          (price) => price.priceMinor !== null && price.priceMinor > max,
        )
      ) {
        throw new FieldProblemException(422, 'above_max_price', [
          { field: 'prices', code: 'above_max_price' },
        ]);
      }

      // the stores in one order (store, product), as every writer of prices: no deadlock
      const ordered = [...wanted].sort((a, b) =>
        a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0,
      );
      const current = await this.repository.lockWholesalePrices(
        trx,
        tenantId,
        id,
        ordered.map((price) => price.storeId),
      );
      // the till sells only a product with a retail price: a wholesale price without one would not work
      if (
        ordered.some(
          (price) =>
            price.priceMinor !== null &&
            (current.get(price.storeId)?.retail ?? null) === null,
        )
      ) {
        throw new FieldProblemException(422, 'no_retail_price', [
          { field: 'prices', code: 'no_retail_price' },
        ]);
      }
      for (const price of ordered) {
        const row = current.get(price.storeId);
        // no row — no retail price and nothing to close
        if (!row) continue;
        const oldMinor = row.wholesale === null ? null : Number(row.wholesale);
        if (oldMinor === price.priceMinor) continue;
        await this.repository.setWholesalePrice(
          trx,
          tenantId,
          id,
          price.storeId,
          price.priceMinor,
        );
        await this.audit.append(trx, {
          action: 'wholesale_price.changed',
          entityType: 'product',
          entityId: id,
          storeId: price.storeId,
          details: {
            storeId: price.storeId,
            oldPriceMinor: oldMinor,
            newPriceMinor: price.priceMinor,
            source: 'prices',
          },
        });
      }
      const stores = await this.repository.activeStores(trx, tenantId, scope);
      const [row] = await this.rows(trx, tenantId, [product], stores);
      return row.prices;
    });
  }

  /** Rows of the price list: one per product, prices in the order of `stores`. */
  private async rows(
    trx: TenantTransaction,
    tenantId: string,
    products: readonly PricingProduct[],
    stores: readonly StoreRef[],
  ): Promise<PriceRow[]> {
    const { permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    // the last purchase price of a pack (E15): shown and compared only with the cost permission,
    // compared only when the network asks for the warning
    const costs = canSeeCost
      ? await this.purchasePrices.lastPackCosts(
          trx,
          tenantId,
          products.map((product) => product.id),
        )
      : new Map<string, number>();
    const { warnBelowCost } = await this.repository.settings(trx, tenantId);
    const cells = await this.repository.prices(
      trx,
      tenantId,
      products.map((product) => product.id),
      stores.map((store) => store.id),
    );
    const priceAt = new Map(
      cells.map((cell) => [`${cell.productId}/${cell.storeId}`, cell]),
    );
    // in stock without a price — the till cannot sell it (E7); a warehouse does not sell
    const stocked = await this.stocked.stockedAt(
      trx,
      tenantId,
      stores.filter((store) => store.kind === 'pharmacy').map((s) => s.id),
      products.map((product) => product.id),
    );
    return products.map((product) => ({
      productId: product.id,
      productName: product.name,
      ...(canSeeCost ? { costMinor: costs.get(product.id) ?? null } : {}),
      markupPercent: markupPercent(product),
      maxPriceMinor: product.maxPriceMinor,
      prices: stores.map((store) => {
        const cell = priceAt.get(`${product.id}/${store.id}`);
        const price = cell?.priceDirams ?? null;
        const wholesale = cell?.wholesaleDirams ?? null;
        const priceMinor = price === null ? null : Number(price);
        const wholesalePriceMinor =
          wholesale === null ? null : Number(wholesale);
        const costMinor = warnBelowCost
          ? (costs.get(product.id) ?? null)
          : null;
        return {
          storeId: store.id,
          storeName: store.name,
          priceMinor,
          warnings: priceWarnings({
            priceMinor,
            costMinor,
            maxPriceMinor: product.maxPriceMinor,
            inStock: stocked.has(`${store.id}/${product.id}`),
          }),
          wholesalePriceMinor,
          wholesaleWarnings: wholesalePriceWarnings({
            wholesaleMinor: wholesalePriceMinor,
            retailMinor: priceMinor,
            costMinor,
            maxPriceMinor: product.maxPriceMinor,
          }),
        };
      }),
    }));
  }
}
