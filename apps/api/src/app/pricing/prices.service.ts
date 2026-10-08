import { Injectable } from '@nestjs/common';
import { hasPermissions, priceWarnings } from '@pharmacy/shared-domain';
import type {
  PriceListQuery,
  PriceListResponse,
  PriceRow,
  StorePrice,
  UpdatePricesRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { type PricingProduct, ProductsReader } from '../catalog/products-reader';
import { PricingRepository, type StoreRef } from './pricing.repository';

const notFound = () => new ProblemException(404, 'not_found');

/** The session scope as store ids; null — the whole network. */
export const scopeIds = (storeScope: 'all' | readonly string[]): readonly string[] | null =>
  storeScope === 'all' ? null : storeScope;

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
    private readonly audit: AuditService,
  ) {}

  async list(query: PriceListQuery): Promise<PriceListResponse> {
    const { tenantId, storeScope } = requirePrincipal();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const stores = await this.repository.activeStores(trx, tenantId, scopeIds(storeScope));
      const page = await this.products.listForPricing(trx, tenantId, {
        q: query.q,
        categoryId: query.categoryId,
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
      const stores = await this.repository.activeStores(trx, tenantId, scopeIds(storeScope));
      const [row] = await this.rows(trx, tenantId, [product], stores);
      return row.prices;
    });
  }

  async update(productId: string, request: UpdatePricesRequest): Promise<PriceRow> {
    const { tenantId, storeScope, permissions, employeeId } = requirePrincipal();
    const network = hasPermissions(permissions, 'pricing:update-network');
    if (!network && !hasPermissions(permissions, 'pricing:update-store')) {
      throw new ProblemException(403, 'forbidden');
    }
    const id = productId.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const [product] = await this.products.findForPricing(trx, tenantId, [id]);
      if (!product) throw notFound();
      if (product.status === 'archived') throw new ProblemException(409, 'product_archived');

      const wanted = request.prices.map((price) => ({
        storeId: price.storeId.toLowerCase(),
        priceMinor: price.priceMinor,
      }));
      const active = new Set(
        (await this.repository.activeStores(trx, tenantId, null)).map((store) => store.id),
      );
      if (wanted.some((price) => !active.has(price.storeId))) throw notFound();
      // Nothing is written when any store of the request is outside the editor's rights.
      const scope = scopeIds(storeScope);
      if (!network && scope !== null && wanted.some((price) => !scope.includes(price.storeId))) {
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

      const current = await this.repository.lockPrices(
        trx,
        tenantId,
        id,
        wanted.map((price) => price.storeId),
      );
      for (const price of wanted) {
        const old = current.get(price.storeId) ?? null;
        if (old !== null && Number(old) === price.priceMinor) continue;
        await this.repository.setPrice(trx, tenantId, id, price.storeId, price.priceMinor, employeeId);
        await this.audit.append(trx, {
          action: 'price.changed',
          entityType: 'product',
          entityId: id,
          storeId: price.storeId,
          details: {
            storeId: price.storeId,
            oldPriceMinor: old === null ? null : Number(old),
            newPriceMinor: price.priceMinor,
          },
        });
      }
      const stores = await this.repository.activeStores(trx, tenantId, scope);
      const [row] = await this.rows(trx, tenantId, [product], stores);
      return row;
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
    const cells = await this.repository.prices(
      trx,
      tenantId,
      products.map((product) => product.id),
      stores.map((store) => store.id),
    );
    const priceAt = new Map(
      cells.map((cell) => [`${cell.productId}/${cell.storeId}`, cell.priceDirams]),
    );
    return products.map((product) => ({
      productId: product.id,
      productName: product.name,
      // No purchase price before the goods receipts of the stock module.
      ...(canSeeCost ? { costMinor: null } : {}),
      markupPercent: markupPercent(product),
      maxPriceMinor: product.maxPriceMinor,
      prices: stores.map((store) => {
        const price = priceAt.get(`${product.id}/${store.id}`) ?? null;
        const priceMinor = price === null ? null : Number(price);
        return {
          storeId: store.id,
          storeName: store.name,
          priceMinor,
          warnings:
            priceMinor === null
              ? []
              : priceWarnings({ priceMinor, costMinor: null, maxPriceMinor: product.maxPriceMinor }),
        };
      }),
    }));
  }
}
