import type { CatalogSnapshot, PosProduct } from '@pharmacy/shared-dto';
import {
  batchState,
  buildCatalogIndex,
  fefoBatches,
  mergeSnapshot,
  sellablePieces,
} from './catalog-index';

const TODAY = '2026-10-01';

const product = (
  id: string,
  name: string,
  inn: string | null,
  pieces: number,
  expiresOn = '2027-01-01',
): PosProduct => ({
  id,
  name,
  inn,
  manufacturer: 'X',
  country: 'TJ',
  form: '—',
  categoryId: id === 'kids' ? 'children' : 'analgesics',
  barcodes: [`48700${id.length}${id}`],
  piecesPerPack: 10,
  divisible: false,
  prescription: 'none',
  priceMinor: 100,
  piecePriceMinor: null,
  batches: [{ id: `${id}-b`, number: 'B', expiresOn, quantityPieces: pieces }],
});

const snapshot = (products: PosProduct[], version = 1): CatalogSnapshot => ({
  version,
  full: true,
  products,
  removedProductIds: [],
  categories: [],
  discountRules: [],
  settings: {
    networkName: 'Сеть',
    storeName: 'Точка',
    storeAddress: 'адрес',
    taxId: '0',
    receiptFooter: '',
    returnWindowDays: 14,
  },
});

const ibu400 = product('ibu400', 'Ибупрофен 400 мг', 'Ibuprofen', 0);
const nurofen = product('nurofen', 'Нурофен 200 мг', 'Ibuprofen', 40);
const expired = product(
  'ibuOld',
  'Ибупрофен старый',
  'Ibuprofen',
  40,
  '2026-09-01',
);
const kids = product('kids', 'Ҳабҳо барои кӯдакон', null, 10);

describe('catalog index', () => {
  const index = buildCatalogIndex(snapshot([ibu400, nurofen, expired, kids]));

  it('finds by barcode, name words, МНН and category', () => {
    expect(index.byBarcode.get(nurofen.barcodes[0])?.id).toBe('nurofen');
    expect(index.search('нуро 200').map((p) => p.id)).toEqual(['nurofen']);
    expect(index.search('ibuprofen').map((p) => p.id)).toEqual([
      'ibu400',
      'nurofen',
      'ibuOld',
    ]);
    expect(index.search('', 'children').map((p) => p.id)).toEqual(['kids']);
  });

  it('matches Tajik letters regardless of Unicode composition', () => {
    expect(index.search('ҲАБҲО'.normalize('NFD')).map((p) => p.id)).toEqual([
      'kids',
    ]);
  });

  it('offers only sellable analogs by МНН', () => {
    expect(index.analogsOf(ibu400, TODAY).map((p) => p.id)).toEqual([
      'nurofen',
    ]);
  });

  it('keeps expired batches out of FEFO and stock', () => {
    expect(fefoBatches(expired, TODAY)).toEqual([]);
    expect(sellablePieces(expired, TODAY)).toBe(0);
    expect(batchState(expired.batches[0], TODAY)).toBe('expired');
    expect(
      batchState({ ...nurofen.batches[0], expiresOn: '2026-10-20' }, TODAY),
    ).toBe('expiring');
    expect(batchState(nurofen.batches[0], TODAY)).toBe('ok');
  });
});

describe('mergeSnapshot', () => {
  it('applies changed and removed products to the stored snapshot', () => {
    const stored = snapshot([ibu400, nurofen], 1);
    const delta: CatalogSnapshot = {
      ...snapshot([{ ...nurofen, priceMinor: 999 }], 2),
      full: false,
      removedProductIds: ['ibu400'],
    };
    const merged = mergeSnapshot(stored, delta);
    expect(merged.version).toBe(2);
    expect(merged.full).toBe(true);
    expect(merged.products.map((p) => [p.id, p.priceMinor])).toEqual([
      ['nurofen', 999],
    ]);
  });

  it('takes a full snapshot as is', () => {
    const full = snapshot([kids], 3);
    expect(mergeSnapshot(snapshot([ibu400]), full)).toBe(full);
  });
});
