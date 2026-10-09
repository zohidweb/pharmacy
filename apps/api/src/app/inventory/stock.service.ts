import { Injectable } from '@nestjs/common';
import { hasPermissions, type StockState } from '@pharmacy/shared-domain';
import type {
  ProductBatchRow,
  StockListQuery,
  StockListResponse,
  StockProductOption,
  StockRow,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { TenantDatabase } from '../../core/database';
import { ProductsReader, type StockProduct } from '../catalog/products-reader';
import { StorePriceWriter } from '../pricing/store-price-writer';
import { InventoryRepository } from './inventory.repository';
import { StockRepository } from './stock.repository';

const DAY_MS = 86_400_000;
const days = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );

/**
 * State of a stock row (spec 4.2): negative and out by the row; expiring by the batch within the
 * reminder days of the network; low by the stock of the product at the store below its minimum.
 */
function stateOf(input: {
  rowQty: number;
  productQty: number;
  minPieces: number;
  expiryDate: string | null;
  today: string;
  reminderDays: number;
}): StockState {
  if (input.rowQty < 0) return 'negative';
  if (input.rowQty === 0) return 'out';
  if (
    input.expiryDate !== null &&
    days(input.today, input.expiryDate) <= input.reminderDays
  ) {
    return 'expiring';
  }
  if (input.productQty < input.minPieces) return 'low';
  return 'ok';
}

const markupOf = (product: StockProduct): number | null => {
  const bp = product.markupBp ?? product.categoryMarkupBp;
  return bp === null ? null : bp / 100;
};

// Stock of the stores (spec 2026-10-09-inventory-purchasing, section 4.2): batches with their stock
// from movements, products with a price but no stock, the options of document lines and the batches
// of the product card. Purchase prices only with `finance:view-cost`.
@Injectable()
export class StockService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockRepository,
    private readonly inventory: InventoryRepository,
    private readonly products: ProductsReader,
    private readonly prices: StorePriceWriter,
  ) {}

  async list(query: StockListQuery): Promise<StockListResponse> {
    const { tenantId, storeScope, permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    const scope = storeScope === 'all' ? null : storeScope;
    const storeId = query.storeId?.toLowerCase();
    if (storeId && scope !== null && !scope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const stores = (
        await this.inventory.activeStores(trx, tenantId, scope)
      ).filter((s) => !storeId || s.id === storeId);
      const storeIds = stores.map((s) => s.id);
      const settings = await this.inventory.settings(trx, tenantId);
      const found = await this.products.searchIds(trx, tenantId, query.q);
      const batches = await this.stock.batchStock(
        trx,
        tenantId,
        storeIds,
        found,
      );
      const priced = await this.prices.pricedAt(trx, tenantId, storeIds);
      const wanted = found === null ? null : new Set(found);
      const productIds = new Set(batches.map((b) => b.productId));
      for (const key of priced.keys()) {
        const productId = key.split('/')[1];
        if (wanted === null || wanted.has(productId)) productIds.add(productId);
      }
      const products = new Map(
        (await this.products.findForStock(trx, tenantId, [...productIds])).map(
          (p) => [p.id, p],
        ),
      );
      const totals = new Map<string, number>();
      for (const b of batches) {
        const key = `${b.storeId}/${b.productId}`;
        totals.set(key, (totals.get(key) ?? 0) + b.qty);
      }
      const storeOf = new Map(stores.map((s) => [s.id, s]));
      const row = (
        storeIdOf: string,
        product: StockProduct,
        batch: (typeof batches)[number] | null,
      ): StockRow => {
        const store = storeOf.get(storeIdOf);
        const key = `${storeIdOf}/${product.id}`;
        const qty = batch?.qty ?? 0;
        return {
          id: batch?.batchId ?? `${storeIdOf}:${product.id}`,
          productId: product.id,
          productName: product.name,
          barcode: product.barcodes[0] ?? null,
          prescription: product.prescription,
          storeId: storeIdOf,
          storeName: store?.name ?? '—',
          storeMode: store?.mode === 'online' ? 'cloud' : 'offline',
          batchId: batch?.batchId ?? null,
          batchNumber: batch ? (batch.lotNumber ?? '') : null,
          expiresOn: batch?.expiryDate ?? null,
          quantityPieces: qty,
          piecesPerPack: product.piecesPerPack,
          minPieces: product.minStockPieces,
          ...(canSeeCost && batch
            ? { costMinor: Number(batch.purchasePricePerPackDirams) }
            : {}),
          retailPriceMinor: priced.get(key) ?? null,
          state: stateOf({
            rowQty: qty,
            productQty: totals.get(key) ?? 0,
            minPieces: product.minStockPieces,
            expiryDate: batch?.expiryDate ?? null,
            today: settings.today,
            reminderDays: settings.expiryReminderDays,
          }),
        };
      };
      const rows: StockRow[] = [];
      for (const b of batches) {
        const product = products.get(b.productId);
        if (product) rows.push(row(b.storeId, product, b));
      }
      // products the store sells but has no stock of
      for (const key of priced.keys()) {
        const [store, productId] = key.split('/');
        const product = products.get(productId);
        if (
          !product ||
          product.status !== 'active' ||
          (totals.get(key) ?? 0) !== 0
        )
          continue;
        if (wanted !== null && !wanted.has(productId)) continue;
        rows.push(row(store, product, null));
      }

      const counts = {
        low: rows.filter((r) => r.state === 'low').length,
        expiring: rows.filter((r) => r.state === 'expiring').length,
        negative: rows.filter((r) => r.state === 'negative').length,
      };
      const state = query.state ?? 'all';
      const filtered =
        state === 'all' ? rows : rows.filter((r) => r.state === state);
      const direction = query.direction === 'desc' ? -1 : 1;
      const sort = query.sort ?? 'product';
      const value = (r: StockRow): string | number =>
        sort === 'expiresOn'
          ? (r.expiresOn ?? '9999-12-31')
          : sort === 'quantity'
            ? r.quantityPieces
            : sort === 'price'
              ? (r.retailPriceMinor ?? -1)
              : r.productName.toLocaleLowerCase('ru');
      filtered.sort((a, b) => {
        const l = value(a);
        const r = value(b);
        const cmp =
          typeof l === 'number'
            ? l - (r as number)
            : l.localeCompare(r as string, 'ru');
        return cmp * direction || a.id.localeCompare(b.id);
      });
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
        counts,
      };
    });
  }

  async productOptions(
    storeId: string,
    query: { query?: string; limit?: number },
  ): Promise<StockProductOption[]> {
    const { tenantId, storeScope, permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    const id = storeId.toLowerCase();
    if (storeScope !== 'all' && !storeScope.includes(id)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    return this.db.tenantTransaction(async (trx) => {
      const page = await this.products.listForPricing(trx, tenantId, {
        q: query.query,
        limit: query.limit ?? 20,
        offset: 0,
      });
      const ids = page.items.map((p) => p.id);
      const products = await this.products.findForStock(trx, tenantId, ids);
      const byId = new Map(products.map((p) => [p.id, p]));
      const batches = await this.stock.batchStock(trx, tenantId, [id], ids);
      const prices = await this.prices.pricesAt(trx, tenantId, [id], ids);
      return ids.flatMap((productId): StockProductOption[] => {
        const product = byId.get(productId);
        if (!product) return [];
        return [
          {
            id: product.id,
            name: product.name,
            barcodes: product.barcodes,
            categoryId: product.categoryId,
            piecesPerPack: product.piecesPerPack,
            divisible: product.divisible,
            prescription: product.prescription,
            retailPriceMinor: prices.get(`${id}/${product.id}`) ?? null,
            markupPercent: markupOf(product),
            minStockPacks: Math.floor(
              product.minStockPieces / product.piecesPerPack,
            ),
            batches: batches
              .filter((b) => b.productId === product.id && b.qty > 0)
              .map((b) => ({
                id: b.batchId,
                number: b.lotNumber ?? '',
                expiresOn: b.expiryDate,
                quantityPieces: b.qty,
                ...(canSeeCost
                  ? { costMinor: Number(b.purchasePricePerPackDirams) }
                  : {}),
              })),
          },
        ];
      });
    });
  }

  async productBatches(productId: string): Promise<ProductBatchRow[]> {
    const { tenantId, storeScope, permissions } = requirePrincipal();
    const canSeeCost = hasPermissions(permissions, 'finance:view-cost');
    return this.db.tenantTransaction(async (trx) => {
      const stores = await this.inventory.activeStores(
        trx,
        tenantId,
        storeScope === 'all' ? null : storeScope,
      );
      const names = new Map(stores.map((s) => [s.id, s.name]));
      const batches = await this.stock.batchStock(
        trx,
        tenantId,
        stores.map((s) => s.id),
        [productId.toLowerCase()],
      );
      return batches.map((b) => ({
        storeId: b.storeId,
        storeName: names.get(b.storeId) ?? '—',
        batchId: b.batchId,
        batchNumber: b.lotNumber ?? '',
        expiresOn: b.expiryDate,
        quantityPieces: b.qty,
        ...(canSeeCost
          ? { costMinor: Number(b.purchasePricePerPackDirams) }
          : {}),
      }));
    });
  }
}
