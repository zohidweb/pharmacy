/*
 * REST contract of the catalog and prices (ТЗ «Каталог», «Цены и скидки», UI mockups «Каталог
 * товаров», «Карточка товара», «Цены и скидки»). Amounts are integer dirams, TJS only (ADR-0016);
 * purchase prices only with `finance:view-cost` (ADR-0018, п. 6). Sync conflicts (ADR-0014): a price
 * changed both in the cloud and on an offline store is decided by the owner in the cloud; a
 * duplicate product created on an offline store is decided by that store — the cloud only shows it.
 */
import type { DiscountRuleStatus, PriceWarning } from '@pharmacy/shared-domain';
import type { Page } from './platform-tenants.js';
import type { DocumentAuthor } from './tenant-inventory.js';
import type { PosCategory, PrescriptionKind } from './tenant-pos.js';

export type { DiscountRuleStatus, PriceWarning };

export interface ProductBarcode {
  code: string;
  /** Supplier whose packs carry this code; null — the manufacturer's code. */
  supplierId: string | null;
  supplierName: string | null;
}

export type ProductUnit = 'pack' | 'piece' | 'ml';

export interface CatalogProduct {
  id: string;
  nameRu: string;
  nameTj: string;
  /** МНН (glossary). */
  inn: string;
  categoryId: string;
  categoryName: string;
  form: string;
  dosage: string;
  manufacturer: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  unit: ProductUnit;
  piecesPerPack: number;
  divisible: boolean;
  barcodes: ProductBarcode[];
  prescription: PrescriptionKind;
  /** Regulated price: the maximum retail price of a pack; null — not regulated. */
  maxPriceMinor: number | null;
  /** Markup of the product, whole percent; null — the markup of the category. */
  markupPercent: number | null;
  minStockPacks: number;
  /** Network retail price of a pack (stores may override it, «Цены и скидки»). */
  retailPriceMinor: number;
}

/** POST /api/v1/catalog/products, PUT /api/v1/catalog/products/{id} */
export type CatalogProductInput = Omit<
  CatalogProduct,
  'id' | 'categoryName' | 'barcodes' | 'retailPriceMinor'
> & {
  barcodes: Array<Pick<ProductBarcode, 'code' | 'supplierId'>>;
};

export type CatalogFlag = 'rx' | 'controlled' | 'regulated' | 'no_barcode';

export interface CatalogListQuery {
  q?: string;
  categoryId?: string;
  form?: string;
  flag?: CatalogFlag;
  limit?: number;
  offset?: number;
}

export interface CatalogListItem {
  id: string;
  name: string;
  inn: string;
  /** First barcode; null — sold by name only. */
  barcode: string | null;
  categoryName: string;
  form: string;
  manufacturer: string;
  unit: ProductUnit;
  piecesPerPack: number;
  retailPriceMinor: number;
  flags: CatalogFlag[];
}

/** GET /api/v1/catalog/products?q=&categoryId=&form=&flag=&limit=&offset= */
export interface CatalogListResponse extends Page<CatalogListItem> {
  kpi: { products: number; withoutBarcode: number; duplicates: number };
}

/** GET /api/v1/catalog/references — values for the selects of the product card. */
export interface CatalogReferences {
  categories: PosCategory[];
  forms: string[];
  manufacturers: string[];
  inns: string[];
  countries: Array<{ code: string; name: string }>;
}

export type DuplicateMatch = 'barcode' | 'name';
export type DuplicateStatus = 'pending' | 'merged' | 'kept';

/** GET /api/v1/catalog/duplicates — products of offline stores that matched the cloud catalog. */
export interface CatalogDuplicate {
  id: string;
  storeId: string;
  storeName: string;
  addedBy: DocumentAuthor;
  newName: string;
  existingId: string;
  existingName: string;
  matchedBy: DuplicateMatch;
  barcode: string | null;
  status: DuplicateStatus;
}

/** Batch of a product at a store, for the card (cost omitted without `finance:view-cost`). */
export interface ProductBatchRow {
  storeId: string;
  storeName: string;
  batchNumber: string;
  expiresOn: string;
  quantityPieces: number;
}

/** GET /api/v1/catalog/products/{id} */
export interface CatalogProductCard extends CatalogProduct {
  prices: StorePrice[];
  batches: ProductBatchRow[];
}

/* ---------------- prices ---------------- */

export interface StorePrice {
  storeId: string;
  storeName: string;
  priceMinor: number;
  warnings: PriceWarning[];
}

export interface PriceListQuery {
  q?: string;
  categoryId?: string;
  limit?: number;
  offset?: number;
}

export interface PriceRow {
  productId: string;
  productName: string;
  /** Last purchase price of a pack; only with `finance:view-cost`. */
  costMinor?: number;
  /** Markup of the product or its category, whole percent. */
  markupPercent: number;
  maxPriceMinor: number | null;
  /** Prices of the stores in the employee scope, in the order of `stores`. */
  prices: StorePrice[];
}

/** GET /api/v1/prices?q=&categoryId=&limit=&offset= */
export interface PriceListResponse extends Page<PriceRow> {
  stores: Array<{ id: string; name: string }>;
}

/**
 * PUT /api/v1/prices/{productId} — new prices by store. A price above the regulated maximum needs
 * `confirmAboveMax` (soft warning, ТЗ), else 422 `above_max_price`. Stores outside the scope of
 * `pricing:update-store` need `pricing:update-network`. Every change goes to the audit log.
 */
export interface UpdatePricesRequest {
  prices: Array<{ storeId: string; priceMinor: number }>;
  confirmAboveMax: boolean;
}

export interface PriceConflict {
  id: string;
  productId: string;
  productName: string;
  storeId: string;
  storeName: string;
  cloudPriceMinor: number;
  cloudChangedBy: DocumentAuthor;
  localPriceMinor: number;
  localChangedBy: DocumentAuthor;
  /** When the store synchronised and the conflict appeared. */
  syncedAt: string;
}

/** POST /api/v1/price-conflicts/{id}/resolve — the owner decides (ADR-0014). */
export interface ResolvePriceConflictRequest {
  keep: 'cloud' | 'local';
}

/* ---------------- discount rules ---------------- */

export interface DiscountThreshold {
  /** Receipt subtotal from which the threshold applies, dirams. */
  minSubtotalMinor: number;
  percent: number;
}

/** Glossary «Скидочное правило»: thresholds by the receipt subtotal; the best one applies, no sum. */
export interface DiscountRuleDefinition {
  id: string;
  name: string;
  thresholds: DiscountThreshold[];
  /** null — the whole network. */
  storeIds: string[] | null;
  storeNames: string[];
  /** null — indefinite. Dates YYYY-MM-DD, inclusive. */
  period: { from: string; to: string | null } | null;
  author: DocumentAuthor & { role: string };
  status: DiscountRuleStatus;
}

/**
 * POST /api/v1/discount-rules, PUT /api/v1/discount-rules/{id} — network rules need
 * `discounts:manage-network`; rules of own stores also `discounts:manage-store`.
 */
export type DiscountRuleInput = Pick<
  DiscountRuleDefinition,
  'name' | 'thresholds' | 'storeIds' | 'period'
>;
