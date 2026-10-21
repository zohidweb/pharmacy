/**
 * The fields of the three loads and the column headers they are recognized by (spec 2026-10-20-data-import, section
 * 4). The keys are the fields of the rows of the contract, so an issue of the API (`field`) finds its column. The
 * synonyms are written as `normalizeHeader` leaves a header: lower case, `ё` as `е`, no `. , № % ( ) : ; *`.
 */
export type ImportKindKey = 'catalog' | 'opening-balances' | 'suppliers';

export const importKinds: readonly ImportKindKey[] = [
  'catalog',
  'opening-balances',
  'suppliers',
];

export function isImportKind(value: unknown): value is ImportKindKey {
  return (
    typeof value === 'string' &&
    (importKinds as readonly string[]).includes(value)
  );
}

export interface FieldDef {
  key: string;
  /** `one-of` — at least one field of the kind marked so must have a column. */
  required: 'yes' | 'one-of' | 'no';
  /** May take several columns (the barcodes). */
  multiple?: boolean;
  synonyms: readonly string[];
}

const NAME = [
  'наименование',
  'название',
  'наименование товара',
  'товар',
  'номенклатура',
  'препарат',
  'name',
  'product',
];
const BARCODE = [
  'штрихкод',
  'штрих-код',
  'штрих код',
  'шк',
  'ean',
  'ean13',
  'баркод',
  'barcode',
  'штрихкод 2',
  'штрихкод 3',
];
const FORM = ['форма', 'лекарственная форма', 'форма выпуска', 'шакл'];
const DOSAGE = ['дозировка', 'доза', 'миқдор'];

export const kindFields: Record<ImportKindKey, readonly FieldDef[]> = {
  catalog: [
    {
      key: 'nameRu',
      required: 'one-of',
      synonyms: [...NAME, 'наименование ru', 'название ru'],
    },
    {
      key: 'nameTj',
      required: 'one-of',
      synonyms: [
        'ном',
        'номи мол',
        'наименование tj',
        'название tj',
        'name tj',
      ],
    },
    { key: 'barcodes', required: 'no', multiple: true, synonyms: BARCODE },
    {
      key: 'category',
      required: 'no',
      synonyms: [
        'категория',
        'группа',
        'раздел',
        'группа товаров',
        'category',
        'гурӯҳ',
      ],
    },
    { key: 'form', required: 'no', synonyms: FORM },
    { key: 'dosage', required: 'no', synonyms: DOSAGE },
    {
      key: 'inn',
      required: 'no',
      synonyms: [
        'мнн',
        'inn',
        'действующее вещество',
        'международное наименование',
      ],
    },
    {
      key: 'manufacturer',
      required: 'no',
      synonyms: [
        'производитель',
        'изготовитель',
        'фирма',
        'завод',
        'manufacturer',
        'истеҳсолкунанда',
      ],
    },
    {
      key: 'countryCode',
      required: 'no',
      synonyms: [
        'страна',
        'страна производства',
        'страна производитель',
        'country',
        'кишвар',
      ],
    },
    {
      key: 'unit',
      required: 'no',
      synonyms: ['единица', 'ед изм', 'единица измерения', 'unit', 'воҳид'],
    },
    {
      key: 'piecesPerPack',
      required: 'no',
      synonyms: [
        'штук в упаковке',
        'в упаковке',
        'кол-во в уп',
        'количество в упаковке',
        'фасовка',
        'шт в уп',
      ],
    },
    {
      key: 'divisible',
      required: 'no',
      synonyms: [
        'продается поштучно',
        'поштучно',
        'делимый',
        'дробная продажа',
      ],
    },
    {
      key: 'prescription',
      required: 'no',
      synonyms: [
        'отпуск',
        'условия отпуска',
        'рецепт',
        'рецептурный',
        'отпуск по рецепту',
      ],
    },
    {
      key: 'maxPriceMinor',
      required: 'no',
      synonyms: [
        'предельная цена',
        'макс цена',
        'максимальная цена',
        'регулируемая цена',
      ],
    },
    {
      key: 'markupPercent',
      required: 'no',
      synonyms: ['наценка', 'наценка процент'],
    },
    {
      key: 'minStockPacks',
      required: 'no',
      synonyms: [
        'минимальный остаток',
        'мин остаток',
        'минимальный запас',
        'мин запас',
        'минимальный остаток уп',
      ],
    },
  ],
  'opening-balances': [
    { key: 'barcodes', required: 'one-of', multiple: true, synonyms: BARCODE },
    { key: 'name', required: 'one-of', synonyms: NAME },
    { key: 'form', required: 'no', synonyms: FORM },
    { key: 'dosage', required: 'no', synonyms: DOSAGE },
    {
      key: 'batchNumber',
      required: 'no',
      synonyms: [
        'серия',
        'партия',
        'лот',
        'серия партии',
        'batch',
        'lot',
        'силсила',
      ],
    },
    {
      key: 'expiresOn',
      required: 'yes',
      synonyms: [
        'срок годности',
        'годен до',
        'срок',
        'дата истечения',
        'expiry',
        'мӯҳлат',
      ],
    },
    {
      key: 'quantity',
      required: 'yes',
      synonyms: [
        'количество',
        'кол-во',
        'остаток',
        'количество уп',
        'кол-во уп',
        'qty',
        'миқдор уп',
      ],
    },
    {
      key: 'costMinor',
      required: 'yes',
      synonyms: [
        'закупочная цена',
        'цена закупки',
        'себестоимость',
        'закупочная цена за упаковку',
        'цена прихода',
      ],
    },
    {
      key: 'retailPriceMinor',
      required: 'no',
      synonyms: [
        'розничная цена',
        'цена продажи',
        'цена',
        'розничная цена за упаковку',
        'розница',
      ],
    },
  ],
  suppliers: [
    {
      key: 'name',
      required: 'yes',
      synonyms: [
        'поставщик',
        'название',
        'наименование',
        'контрагент',
        'организация',
        'name',
      ],
    },
    {
      key: 'taxId',
      required: 'no',
      synonyms: ['инн', 'рма', 'tin', 'инн поставщика'],
    },
    {
      key: 'phone',
      required: 'no',
      synonyms: ['телефон', 'тел', 'phone', 'контактный телефон'],
    },
    {
      key: 'address',
      required: 'no',
      synonyms: ['адрес', 'address', 'суроға'],
    },
    {
      key: 'paymentDelayDays',
      required: 'no',
      synonyms: [
        'отсрочка',
        'отсрочка платежа',
        'отсрочка дней',
        'дней отсрочки',
      ],
    },
  ],
};
