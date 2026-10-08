/*
 * REST contract of the catalog and prices (ТЗ «Каталог», «Цены и скидки», UI mockups «Каталог
 * товаров», «Карточка товара», «Цены и скидки»). Amounts are integer dirams, TJS only (ADR-0016);
 * purchase prices only with `finance:view-cost` (ADR-0018, п. 6). Sync conflicts (ADR-0014): a price
 * changed both in the cloud and on an offline store is decided by the owner in the cloud; a
 * duplicate product created on an offline store is decided by that store — the cloud only shows it.
 */
import type {
  DiscountRuleStatus,
  PriceWarning,
  ProductUnit,
} from '@pharmacy/shared-domain';
import type { Page } from './platform-tenants.js';
import type { DocumentAuthor } from './tenant-inventory.js';
import type { PosCategory, PrescriptionKind } from './tenant-pos.js';

export type { DiscountRuleStatus, PriceWarning };

/** A barcode of a product, unique in the network (8–14 digits). */
export interface ProductBarcode {
  code: string;
}

/** A product or a category is archived, never deleted (data model). */
export type CatalogStatus = 'active' | 'archived';

export type { ProductUnit };

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
  status: CatalogStatus;
}

/**
 * POST /api/v1/catalog/products (`catalog:create`), PUT /api/v1/catalog/products/{id}
 * (`catalog:update`). The name in the default language of the network is required. 400
 * `validation_failed`; 409 `barcode_taken` (field `barcodes`), `product_archived`.
 */
export type CatalogProductInput = Omit<
  CatalogProduct,
  'id' | 'categoryName' | 'status'
>;

/** POST /api/v1/catalog/products/{id}/status (`catalog:delete`) — archive or restore. */
export interface UpdateCatalogStatusRequest {
  status: CatalogStatus;
}

export type CatalogFlag = 'rx' | 'controlled' | 'regulated' | 'no_barcode';

export interface CatalogListQuery {
  q?: string;
  categoryId?: string;
  form?: string;
  flag?: CatalogFlag;
  /** Default `active`. */
  status?: CatalogStatus;
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
  /** Price of a pack at the current store of the session; null — no store or no price. */
  retailPriceMinor: number | null;
  flags: CatalogFlag[];
  status: CatalogStatus;
}

/**
 * GET /api/v1/catalog/products?q=&categoryId=&form=&flag=&status=&limit=&offset= — `q` matches the
 * name (RU/TJ) or the INN; 8–14 digits also match a barcode. `duplicates` is 0 until the sync.
 */
export interface CatalogListResponse extends Page<CatalogListItem> {
  kpi: { products: number; withoutBarcode: number; duplicates: number };
}

/** GET /api/v1/catalog/references — values for the selects of the product card. */
export interface CatalogReferences {
  categories: PosCategory[];
  /** Names in the default language of the network. */
  forms: string[];
  units: ProductUnit[];
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

/**
 * GET /api/v1/catalog/products/{id}. Prices of the card come from GET /api/v1/prices/{id}; batches
 * come with the stock module.
 */
export type CatalogProductCard = CatalogProduct;

/** GET /api/v1/catalog/categories (`catalog:view`) — active and archived categories. */
export interface Category {
  id: string;
  nameRu: string;
  nameTj: string;
  /** null — no markup of the category. */
  markupPercent: number | null;
  status: CatalogStatus;
  /** Active products of the category. */
  products: number;
}

/**
 * POST /api/v1/catalog/categories, PUT /api/v1/catalog/categories/{id} (`catalog:update`). 409
 * `category_name_taken` (field of the default language).
 */
export interface CategoryInput {
  nameRu: string;
  nameTj: string;
}

/** POST /api/v1/catalog/categories/{id}/status (`catalog:update`). 409 `category_in_use`. */
export type UpdateCategoryStatusRequest = UpdateCatalogStatusRequest;

/* ---------------- prices ---------------- */

export interface StorePrice {
  storeId: string;
  storeName: string;
  /** Price of a pack; null — the product is not sold at the store. */
  priceMinor: number | null;
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
  /** Last purchase price of a pack; only with `finance:view-cost`, null — no purchase yet. */
  costMinor?: number | null;
  /** Markup of the product, else of its category, whole percent; null — none. */
  markupPercent: number | null;
  maxPriceMinor: number | null;
  /** Prices of the stores in the employee scope, in the order of `stores`. */
  prices: StorePrice[];
}

/**
 * GET /api/v1/prices?q=&categoryId=&limit=&offset= — active products × active stores of the scope.
 * GET /api/v1/prices/{productId} returns the `StorePrice[]` of one product for the product card.
 */
export interface PriceListResponse extends Page<PriceRow> {
  stores: Array<{ id: string; name: string }>;
}

/**
 * PUT /api/v1/prices/{productId} — new prices by store. A price above the regulated maximum needs
 * `confirmAboveMax` (soft warning, ТЗ), else 422 `above_max_price`. Stores outside the scope of
 * `pricing:update-store` need `pricing:update-network` (403 `store_not_in_scope`). Every change goes to the audit log;
 * 409 `product_archived`.
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
