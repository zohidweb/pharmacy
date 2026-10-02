/*
 * Catalog part of the mock database: what the product card holds beyond the POS catalog (names in
 * TJ, form and dosage, regulated price, markup), store prices over the network price, sync
 * conflicts of offline stores (ADR-0014) and discount rules. Synthetic data after the UI mockups;
 * amounts in dirams, TJS only.
 */
import type {
  CatalogDuplicate,
  DocumentAuthor,
  PriceConflict,
  ProductUnit,
} from '@pharmacy/shared-dto';
import { DAY_MS, dateIn } from './fixtures-pos';

export interface ProductExtras {
  nameTj: string;
  form: string;
  dosage: string;
  unit: ProductUnit;
  maxPriceMinor: number | null;
  markupPercent: number | null;
  /** Barcode → supplier whose packs carry it. */
  barcodeSuppliers: Record<string, string>;
}

export interface DiscountRuleRecord {
  id: string;
  name: string;
  thresholds: Array<{ minSubtotalMinor: number; percent: number }>;
  storeIds: string[] | null;
  period: { from: string; to: string | null } | null;
  author: DocumentAuthor & { role: string };
}

export interface CatalogMockDb {
  extras: Record<string, ProductExtras>;
  /** storeId → productId → price of a pack; absent — the network price. */
  storePrices: Record<string, Record<string, number>>;
  priceConflicts: PriceConflict[];
  duplicates: CatalogDuplicate[];
  discountRules: DiscountRuleRecord[];
  counters: { product: number; rule: number };
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();
const author = (name: string, days: number): DocumentAuthor => ({
  name,
  at: daysAgo(days),
});

const extras = (
  nameTj: string,
  form: string,
  dosage: string,
  more: Partial<ProductExtras> = {},
): ProductExtras => ({
  nameTj,
  form,
  dosage,
  unit: 'pack',
  maxPriceMinor: null,
  markupPercent: null,
  barcodeSuppliers: {},
  ...more,
});

export function createCatalogDb(): CatalogMockDb {
  return {
    extras: {
      'p-paracetamol': extras(
        'Парасетамол 500 мг, лавҳа №10',
        'Таблетки',
        '500 мг',
        {
          maxPriceMinor: 500,
          barcodeSuppliers: { '4870001000017': 'sup-pharm-import' },
        },
      ),
      'p-amoxicillin': extras(
        'Амоксисиллин 500 мг, капсула №16',
        'Капсулы',
        '500 мг',
      ),
      'p-ibuprofen-400': extras(
        'Ибупрофен 400 мг, лавҳа №20',
        'Таблетки',
        '400 мг',
      ),
      'p-ibuprofen-200': extras(
        'Ибупрофен 200 мг, лавҳа №20',
        'Таблетки',
        '200 мг',
      ),
      'p-nurofen': extras('Нурофен 200 мг, лавҳа №10', 'Таблетки', '200 мг', {
        markupPercent: 52,
      }),
      'p-ibufen': extras(
        'Ибуфен суспензия 100 мг/5 мл, 100 мл',
        'Суспензия',
        '100 мг/5 мл',
        { unit: 'piece' },
      ),
      'p-vitamin-d3': extras(
        'Витамини D3 2000 МЕ, капсула №60',
        'Капсулы',
        '2000 МЕ',
      ),
      'p-tramadol': extras('Трамадол 50 мг, капсула №20', 'Капсулы', '50 мг'),
      'p-saline': extras('Маҳлули намак 0,9% 200 мл', 'Раствор', '0,9%', {
        unit: 'piece',
        maxPriceMinor: 700,
      }),
      'p-nurofen-kids': extras(
        'Нурофен барои кӯдакон суспензия 100 мг/5 мл, 150 мл',
        'Суспензия',
        '100 мг/5 мл',
        { unit: 'piece' },
      ),
    },
    storePrices: {
      'store-2': { 'p-paracetamol': 480 },
      // above the regulated maximum and below the purchase price: the warnings of «Цены и скидки»
      'store-4': { 'p-paracetamol': 520, 'p-amoxicillin': 1_800 },
    },
    priceConflicts: [
      {
        id: 'pc-1',
        productId: 'p-vitamin-d3',
        productName: 'Витамин D3 2000 МЕ, капс. №60',
        storeId: 'store-4',
        storeName: 'Аптека №4 · Вахдат',
        cloudPriceMinor: 6_500,
        cloudChangedBy: author('Фируз А.', 2),
        localPriceMinor: 6_200,
        localChangedBy: author('Нигина Р.', 1),
        syncedAt: daysAgo(0.3),
      },
    ],
    duplicates: [
      {
        id: 'dup-1',
        storeId: 'store-4',
        storeName: 'Аптека №4 · Вахдат',
        addedBy: author('Нигина Р.', 1),
        newName: 'Парацетамол 500мг таб 10',
        existingId: 'p-paracetamol',
        existingName: 'Парацетамол 500 мг, таб. №10',
        matchedBy: 'barcode',
        barcode: '4870001000017',
        status: 'pending',
      },
      {
        id: 'dup-2',
        storeId: 'store-4',
        storeName: 'Аптека №4 · Вахдат',
        addedBy: author('Нигина Р.', 2),
        newName: 'Ибуфен сироп 100мл',
        existingId: 'p-ibufen',
        existingName: 'Ибуфен сусп. 100 мг/5 мл, 100 мл',
        matchedBy: 'name',
        barcode: null,
        status: 'pending',
      },
    ],
    discountRules: [
      {
        id: 'dr-network',
        name: 'Сетевая шкала',
        thresholds: [
          { minSubtotalMinor: 50_000, percent: 3 },
          { minSubtotalMinor: 100_000, percent: 5 },
        ],
        storeIds: null,
        period: null,
        author: { ...author('Фируз А.', 90), role: 'Владелец' },
      },
      {
        id: 'dr-rudaki',
        name: 'Акция «Рудаки — месяц»',
        thresholds: [{ minSubtotalMinor: 30_000, percent: 7 }],
        storeIds: ['store-3'],
        period: { from: dateIn(10), to: dateIn(40) },
        author: { ...author('Манижа К.', 3), role: 'Заведующий точкой' },
      },
      {
        id: 'dr-summer',
        name: 'Летняя акция',
        thresholds: [{ minSubtotalMinor: 20_000, percent: 5 }],
        storeIds: ['store-1', 'store-3'],
        period: { from: dateIn(-120), to: dateIn(-30) },
        author: { ...author('Фируз А.', 125), role: 'Владелец' },
      },
    ],
    counters: { product: 1, rule: 1 },
  };
}
