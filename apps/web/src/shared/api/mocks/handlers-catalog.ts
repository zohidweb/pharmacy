/*
 * Mock handlers of the catalog and prices — the rules apps/api will enforce: `catalog:*` for the
 * product card; a price of an own store needs `pricing:update-store`, of any store
 * `pricing:update-network` (ADR-0018); a price above the regulated maximum is a soft warning the
 * manager confirms; price conflicts of offline stores are decided by the owner, duplicates by the
 * store (ADR-0014); network discount rules need `discounts:manage-network`.
 */
import {
  discountRuleStatus,
  hasPermissions,
  priceWarnings,
  type Permission,
} from '@pharmacy/shared-domain';
import {
  productUnits,
} from '@pharmacy/shared-domain';
import type {
  CatalogFlag,
  CatalogListItem,
  CatalogProduct,
  CatalogProductInput,
  CatalogStatus,
  Category,
  CategoryInput,
  DiscountRuleDefinition,
  DiscountRuleInput,
  EmployeeSession,
  PosProduct,
  PriceRow,
  StorePrice,
} from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb } from './db';
import type { DiscountRuleRecord, ProductExtras } from './db-catalog';
import { stores } from './fixtures';
import { context, findDoc, page, storeName } from './handlers-stock';
import { piecePrice, setStorePrice, storePrice } from './pricing';
import { authorize } from './session';
import type { MockHandlers } from './types';

type CatalogRoute = Extract<
  ApiRouteKey,
  | `catalog.${'list' | 'get' | 'create' | 'update' | 'status' | 'references' | 'duplicates'}`
  | `catalog.${'categories' | 'createCategory' | 'updateCategory' | 'categoryStatus'}`
  | `prices.${string}`
  | `priceConflicts.${string}`
  | `discountRules.${string}`
>;

const catalog = () => mockDb().catalog;
const products = () => mockDb().pos.products;

const validation = (correlationId: string, field: string, code: string) =>
  new ApiError(400, 'validation_failed', correlationId, [{ field, code }]);
const conflict = (correlationId: string, code: string, field?: string) =>
  new ApiError(409, code, correlationId, field ? [{ field, code }] : []);

export const COUNTRIES = [
  { code: 'TJ', name: 'Таджикистан' },
  { code: 'RU', name: 'Россия' },
  { code: 'BY', name: 'Беларусь' },
  { code: 'PL', name: 'Польша' },
  { code: 'AT', name: 'Австрия' },
  { code: 'CZ', name: 'Чехия' },
  { code: 'GB', name: 'Великобритания' },
  { code: 'US', name: 'США' },
  { code: 'IN', name: 'Индия' },
];

const FORMS = [
  'Таблетки',
  'Капсулы',
  'Сироп',
  'Суспензия',
  'Раствор',
  'Мазь',
  'Капли',
];

const extrasOf = (product: PosProduct): ProductExtras =>
  (catalog().extras[product.id] ??= {
    nameTj: '',
    form: '',
    dosage: '',
    unit: 'pack',
    maxPriceMinor: null,
    markupPercent: null,
  });

const categoryRecords = () => catalog().categories;
const categoryName = (id: string) =>
  categoryRecords().find((c) => c.id === id)?.nameRu ?? '—';
const statusOf = (product: PosProduct): CatalogStatus =>
  catalog().archived.includes(product.id) ? 'archived' : 'active';

function toCatalogProduct(product: PosProduct): CatalogProduct {
  const extras = extrasOf(product);
  return {
    id: product.id,
    nameRu: product.name,
    nameTj: extras.nameTj,
    inn: product.inn ?? '',
    categoryId: product.categoryId,
    categoryName: categoryName(product.categoryId),
    form: extras.form,
    dosage: extras.dosage,
    manufacturer: product.manufacturer,
    countryCode: product.country,
    unit: extras.unit,
    piecesPerPack: product.piecesPerPack,
    divisible: product.divisible,
    barcodes: product.barcodes.map((code) => ({ code })),
    prescription: product.prescription,
    maxPriceMinor: extras.maxPriceMinor,
    markupPercent: extras.markupPercent,
    minStockPacks: mockDb().stock.minPacks[product.id] ?? 0,
    status: statusOf(product),
  };
}

function flagsOf(product: PosProduct): CatalogFlag[] {
  const flags: CatalogFlag[] = [];
  if (product.prescription === 'rx') flags.push('rx');
  if (product.prescription === 'controlled') flags.push('controlled');
  if (extrasOf(product).maxPriceMinor !== null) flags.push('regulated');
  if (product.barcodes.length === 0) flags.push('no_barcode');
  return flags;
}

/** Last purchase price of a pack: the newest posted receipt, else the batch with the latest expiry. */
function lastCost(product: PosProduct): number | undefined {
  const received = mockDb()
    .stock.goodsReceipts.filter((r) => r.status === 'posted')
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((r) => r.lines)
    .find((l) => l.productId === product.id)?.costMinor;
  return (
    received ??
    [...product.batches]
      .filter((b) => b.costMinor !== undefined)
      .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0]?.costMinor
  );
}

function pricesOf(
  product: PosProduct,
  session: EmployeeSession,
  canSeeCost: boolean,
): StorePrice[] {
  const cost = canSeeCost ? lastCost(product) : undefined;
  return session.stores.map((store) => {
    const priceMinor = storePrice(store.id, product);
    return {
      storeId: store.id,
      storeName: store.name,
      priceMinor,
      warnings: priceWarnings({
        priceMinor,
        costMinor: cost,
        maxPriceMinor: extrasOf(product).maxPriceMinor,
      }),
    };
  });
}

function productInput(
  body: CatalogProductInput,
  correlationId: string,
  exceptId?: string,
) {
  if (!body.nameRu.trim())
    throw validation(correlationId, 'nameRu', 'required');
  if (
    !categoryRecords().some(
      (c) => c.id === body.categoryId && c.status === 'active',
    )
  ) {
    throw validation(correlationId, 'categoryId', 'required');
  }
  if (body.divisible && body.piecesPerPack < 2) {
    throw validation(correlationId, 'divisible', 'invalid');
  }
  if (!Number.isInteger(body.piecesPerPack) || body.piecesPerPack < 1) {
    throw validation(correlationId, 'piecesPerPack', 'positive');
  }
  const codes = body.barcodes.map((b) => b.code.trim()).filter(Boolean);
  if (codes.some((code) => !/^\d{8,14}$/.test(code))) {
    throw validation(correlationId, 'barcodes', 'format');
  }
  const taken = products().find(
    (p) => p.id !== exceptId && p.barcodes.some((code) => codes.includes(code)),
  );
  if (taken) throw conflict(correlationId, 'barcode_taken', 'barcodes');
  if (body.maxPriceMinor !== null && body.maxPriceMinor <= 0) {
    throw validation(correlationId, 'maxPriceMinor', 'positive');
  }
  if (
    body.markupPercent !== null &&
    (!Number.isInteger(body.markupPercent) || body.markupPercent < 0)
  ) {
    throw validation(correlationId, 'markupPercent', 'invalid');
  }
  return codes;
}

function applyProduct(
  product: PosProduct,
  body: CatalogProductInput,
  codes: string[],
) {
  product.name = body.nameRu.trim();
  product.inn = body.inn.trim() || null;
  product.categoryId = body.categoryId;
  product.manufacturer = body.manufacturer.trim();
  product.country = body.countryCode;
  product.form = [body.form, body.dosage]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  product.piecesPerPack = body.piecesPerPack;
  product.divisible = body.divisible && body.piecesPerPack > 1;
  product.prescription = body.prescription;
  product.barcodes = codes;
  catalog().extras[product.id] = {
    nameTj: body.nameTj.trim(),
    form: body.form,
    dosage: body.dosage.trim(),
    unit: body.unit,
    maxPriceMinor: body.maxPriceMinor,
    markupPercent: body.markupPercent,
  };
  mockDb().stock.minPacks[product.id] = body.minStockPacks;
  mockDb().pos.catalogVersion += 1;
}

/* ---------------- categories ---------------- */

const activeProductsOf = (categoryId: string) =>
  products().filter(
    (p) => p.categoryId === categoryId && statusOf(p) === 'active',
  ).length;

function toCategory(record: {
  id: string;
  nameRu: string;
  nameTj: string;
  status: CatalogStatus;
}): Category {
  const markup = mockDb().stock.markup[record.id];
  return {
    ...record,
    markupPercent: markup ?? null,
    products: activeProductsOf(record.id),
  };
}

function categoryInput(
  body: CategoryInput,
  correlationId: string,
  exceptId?: string,
): CategoryInput {
  const nameRu = body.nameRu.trim();
  if (!nameRu || nameRu.length > 100) {
    throw validation(correlationId, 'nameRu', 'required');
  }
  const key = nameRu.toLocaleLowerCase('ru');
  if (
    categoryRecords().some(
      (c) => c.id !== exceptId && c.nameRu.toLocaleLowerCase('ru') === key,
    )
  ) {
    throw conflict(correlationId, 'category_name_taken', 'nameRu');
  }
  return { nameRu, nameTj: body.nameTj.trim() };
}

/* ---------------- discount rules ---------------- */

function toRule(rule: DiscountRuleRecord): DiscountRuleDefinition {
  return {
    ...rule,
    storeNames: rule.storeIds?.map(storeName) ?? [],
    status: discountRuleStatus(rule.period, toAppDate()),
  };
}

function ruleInput(
  body: DiscountRuleInput,
  session: EmployeeSession,
  correlationId: string,
) {
  const network: Permission = 'discounts:manage-network';
  if (body.storeIds === null || body.storeIds.length === 0) {
    if (body.storeIds !== null) {
      throw validation(correlationId, 'storeIds', 'required');
    }
    authorize(correlationId, network);
  } else if (!hasPermissions(session.permissions, network)) {
    authorize(correlationId, 'discounts:manage-store');
    if (body.storeIds.some((id) => !session.stores.some((s) => s.id === id))) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
  }
  if (!body.name.trim()) throw validation(correlationId, 'name', 'required');
  const thresholds = [...body.thresholds].sort(
    (a, b) => a.minSubtotalMinor - b.minSubtotalMinor,
  );
  if (
    thresholds.length === 0 ||
    thresholds.some(
      (t) =>
        !Number.isInteger(t.percent) ||
        t.percent < 1 ||
        t.percent > 100 ||
        t.minSubtotalMinor <= 0,
    )
  ) {
    throw validation(correlationId, 'thresholds', 'invalid');
  }
  if (
    new Set(thresholds.map((t) => t.minSubtotalMinor)).size !==
    thresholds.length
  ) {
    throw validation(correlationId, 'thresholds', 'duplicate');
  }
  if (
    body.period &&
    body.period.to !== null &&
    body.period.to < body.period.from
  ) {
    throw validation(correlationId, 'period', 'invalid');
  }
  return {
    name: body.name.trim(),
    thresholds,
    storeIds: body.storeIds,
    period: body.period,
  };
}

export const catalogHandlers: Pick<MockHandlers, CatalogRoute> = {
  'catalog.list': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'catalog:view');
    const status = query?.status ?? 'active';
    const needle = (query?.q ?? '').trim().toLocaleLowerCase('ru');
    const all = products()
      .filter(
        (p) =>
          !needle ||
          [p.name, p.inn ?? '', extrasOf(p).nameTj, ...p.barcodes].some((v) =>
            v.toLocaleLowerCase('ru').includes(needle),
          ),
      )
      .filter((p) => !query?.categoryId || p.categoryId === query.categoryId)
      .filter((p) => !query?.form || extrasOf(p).form === query.form)
      .filter((p) => !query?.flag || flagsOf(p).includes(query.flag))
      .filter((p) => statusOf(p) === status)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const active = products().filter((p) => statusOf(p) === 'active');
    return {
      ...page(
        all.map((p): CatalogListItem => ({
          id: p.id,
          name: p.name,
          inn: p.inn ?? '',
          barcode: p.barcodes[0] ?? null,
          categoryName: categoryName(p.categoryId),
          form: extrasOf(p).form,
          manufacturer: p.manufacturer,
          unit: extrasOf(p).unit,
          piecesPerPack: p.piecesPerPack,
          // the price of the current store of the session (mocks fall back to the network price)
          retailPriceMinor: session.currentStoreId
            ? storePrice(session.currentStoreId, p) || null
            : null,
          flags: flagsOf(p),
          status: statusOf(p),
        })),
        { limit: query?.limit ?? 20, offset: query?.offset },
      ),
      kpi: {
        products: active.length,
        withoutBarcode: active.filter((p) => p.barcodes.length === 0).length,
        duplicates: catalog().duplicates.filter((d) => d.status === 'pending')
          .length,
      },
    };
  },
  'catalog.get': ({ params, correlationId }) => {
    context(correlationId, 'catalog:view');
    return toCatalogProduct(findDoc(products(), params.id, correlationId));
  },
  'catalog.create': ({ body, correlationId }) => {
    context(correlationId, 'catalog:create', { write: true });
    const codes = productInput(body, correlationId);
    const product: PosProduct = {
      id: `p-new-${catalog().counters.product++}`,
      name: '',
      inn: '',
      manufacturer: '',
      country: '',
      form: '',
      categoryId: body.categoryId,
      barcodes: [],
      piecesPerPack: 1,
      divisible: false,
      prescription: 'none',
      // the retail price comes from the first goods receipt by the markup
      priceMinor: 0,
      piecePriceMinor: null,
      batches: [],
    };
    applyProduct(product, body, codes);
    products().push(product);
    return toCatalogProduct(product);
  },
  'catalog.update': ({ params, body, correlationId }) => {
    context(correlationId, 'catalog:update', { write: true });
    const product = findDoc(products(), params.id, correlationId);
    if (statusOf(product) === 'archived') {
      throw conflict(correlationId, 'product_archived');
    }
    const codes = productInput(body, correlationId, product.id);
    applyProduct(product, body, codes);
    product.piecePriceMinor = piecePrice(product, product.priceMinor);
    return toCatalogProduct(product);
  },
  'catalog.status': ({ params, body, correlationId }) => {
    context(correlationId, 'catalog:delete', { write: true });
    const product = findDoc(products(), params.id, correlationId);
    catalog().archived = catalog().archived.filter((id) => id !== product.id);
    if (body.status === 'archived') catalog().archived.push(product.id);
    mockDb().pos.catalogVersion += 1;
    return toCatalogProduct(product);
  },
  'catalog.categories': ({ correlationId }) => {
    context(correlationId, 'catalog:view');
    return categoryRecords().map(toCategory);
  },
  'catalog.createCategory': ({ body, correlationId }) => {
    context(correlationId, 'catalog:update', { write: true });
    const input = categoryInput(body, correlationId);
    const record = {
      id: `cat-new-${catalog().counters.category++}`,
      ...input,
      status: 'active' as const,
    };
    categoryRecords().push(record);
    return toCategory(record);
  },
  'catalog.updateCategory': ({ params, body, correlationId }) => {
    context(correlationId, 'catalog:update', { write: true });
    const record = findDoc(categoryRecords(), params.id, correlationId);
    Object.assign(record, categoryInput(body, correlationId, record.id));
    return toCategory(record);
  },
  'catalog.categoryStatus': ({ params, body, correlationId }) => {
    context(correlationId, 'catalog:update', { write: true });
    const record = findDoc(categoryRecords(), params.id, correlationId);
    if (body.status === 'archived' && activeProductsOf(record.id) > 0) {
      throw conflict(correlationId, 'category_in_use');
    }
    record.status = body.status;
    return toCategory(record);
  },
  'catalog.references': ({ correlationId }) => {
    context(correlationId, 'catalog:view');
    const unique = (values: string[]) =>
      [...new Set(values.filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'ru'),
      );
    return {
      categories: categoryRecords()
        .filter((c) => c.status === 'active')
        .map((c) => ({ id: c.id, name: c.nameRu })),
      forms: unique([...FORMS, ...products().map((p) => extrasOf(p).form)]),
      units: [...productUnits],
      manufacturers: unique(products().map((p) => p.manufacturer)),
      inns: unique(products().map((p) => p.inn ?? '')),
      countries: COUNTRIES,
    };
  },
  'catalog.duplicates': ({ correlationId }) => {
    context(correlationId, 'catalog:view');
    return catalog().duplicates;
  },

  'prices.list': ({ query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'pricing:view');
    const needle = (query?.q ?? '').trim().toLocaleLowerCase('ru');
    const rows = products()
      .filter((p) => statusOf(p) === 'active')
      .filter(
        (p) =>
          !needle ||
          [p.name, p.inn ?? '', ...p.barcodes].some((v) =>
            v.toLocaleLowerCase('ru').includes(needle),
          ),
      )
      .filter((p) => !query?.categoryId || p.categoryId === query.categoryId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((p): PriceRow => ({
        productId: p.id,
        productName: p.name,
        markupPercent:
          extrasOf(p).markupPercent ??
          mockDb().stock.markup[p.categoryId] ??
          40,
        maxPriceMinor: extrasOf(p).maxPriceMinor,
        prices: pricesOf(p, session, canSeeCost),
        ...(canSeeCost && { costMinor: lastCost(p) ?? 0 }),
      }));
    return {
      ...page(rows, { limit: query?.limit ?? 20, offset: query?.offset }),
      stores: session.stores.map((s) => ({ id: s.id, name: s.name })),
    };
  },
  'prices.get': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'pricing:view');
    const product = findDoc(products(), params.productId, correlationId);
    return pricesOf(product, session, canSeeCost);
  },
  'prices.update': ({ params, body, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'pricing:view', {
      write: true,
    });
    const product = findDoc(products(), params.productId, correlationId);
    if (statusOf(product) === 'archived') {
      throw conflict(correlationId, 'product_archived');
    }
    const network = hasPermissions(
      session.permissions,
      'pricing:update-network',
    );
    if (!network) authorize(correlationId, 'pricing:update-store');
    for (const price of body.prices) {
      if (!stores.some((s) => s.id === price.storeId)) {
        throw validation(correlationId, 'storeId', 'unknown');
      }
      if (!network && !session.stores.some((s) => s.id === price.storeId)) {
        throw new ApiError(403, 'store_not_in_scope', correlationId);
      }
      if (!Number.isInteger(price.priceMinor) || price.priceMinor <= 0) {
        throw validation(correlationId, 'priceMinor', 'positive');
      }
    }
    const max = extrasOf(product).maxPriceMinor;
    if (
      !body.confirmAboveMax &&
      max !== null &&
      body.prices.some((p) => p.priceMinor > max)
    ) {
      throw new ApiError(422, 'above_max_price', correlationId, [
        { field: 'prices', code: 'above_max_price' },
      ]);
    }
    for (const price of body.prices) {
      setStorePrice(price.storeId, product.id, price.priceMinor);
    }
    mockDb().activity.unshift({
      id: `a-${Date.now()}`,
      at: new Date().toISOString(),
      actorName: session.employee.fullName,
      storeName: null,
      description: `Цена · ${product.name}`,
    });
    mockDb().pos.catalogVersion += 1;
    return {
      productId: product.id,
      productName: product.name,
      markupPercent:
        extrasOf(product).markupPercent ??
        mockDb().stock.markup[product.categoryId] ??
        40,
      maxPriceMinor: max,
      prices: pricesOf(product, session, canSeeCost),
      ...(canSeeCost && { costMinor: lastCost(product) ?? 0 }),
    };
  },
  'priceConflicts.list': ({ correlationId }) => {
    const { session } = context(correlationId, 'pricing:view');
    return catalog().priceConflicts.filter((c) =>
      session.stores.some((s) => s.id === c.storeId),
    );
  },
  'priceConflicts.resolve': ({ params, body, correlationId }) => {
    // the owner decides price conflicts in the cloud (ADR-0014)
    context(correlationId, 'pricing:update-network', { write: true });
    const conflict = findDoc(
      catalog().priceConflicts,
      params.id,
      correlationId,
    );
    setStorePrice(
      conflict.storeId,
      conflict.productId,
      body.keep === 'cloud'
        ? conflict.cloudPriceMinor
        : conflict.localPriceMinor,
    );
    catalog().priceConflicts = catalog().priceConflicts.filter(
      (c) => c.id !== conflict.id,
    );
    mockDb().pos.catalogVersion += 1;
  },

  'discountRules.list': ({ correlationId }) => {
    const { session } = context(correlationId, 'discounts:view');
    return catalog()
      .discountRules.filter(
        (r) =>
          r.storeIds === null ||
          r.storeIds.some((id) => session.stores.some((s) => s.id === id)),
      )
      .map(toRule);
  },
  'discountRules.create': ({ body, correlationId }) => {
    const { session, author } = context(correlationId, 'discounts:view', {
      write: true,
    });
    const employee = mockDb().employees.find(
      (e) => e.id === session.employee.id,
    );
    const rule: DiscountRuleRecord = {
      id: `dr-${catalog().counters.rule++}`,
      ...ruleInput(body, session, correlationId),
      author: {
        ...author(),
        role:
          mockDb().owner.roles.find((r) => r.id === employee?.roleId)?.name ??
          '—',
      },
    };
    catalog().discountRules.unshift(rule);
    mockDb().pos.catalogVersion += 1;
    return toRule(rule);
  },
  'discountRules.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'discounts:view', {
      write: true,
    });
    const rule = findDoc(catalog().discountRules, params.id, correlationId);
    // editing a rule needs the right for its current scope too
    ruleInput({ ...body, storeIds: rule.storeIds }, session, correlationId);
    Object.assign(rule, ruleInput(body, session, correlationId));
    mockDb().pos.catalogVersion += 1;
    return toRule(rule);
  },
};
