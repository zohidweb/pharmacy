/*
 * Closed lists and starter values of the catalog (spec 2026-10-07-catalog-pricing, sections 2 and
 * 4). A new network gets `catalogDefaults` once, at provisioning; later changes here do not reach
 * existing networks. Tajik names are to be reviewed by a native speaker.
 */

/** Unit of a product; the frontends translate it by the code (decision C9). */
export const productUnits = ['pack', 'piece', 'ml'] as const;
export type ProductUnit = (typeof productUnits)[number];

export function isProductUnit(value: unknown): value is ProductUnit {
  return typeof value === 'string' && (productUnits as readonly string[]).includes(value);
}

/** A name in both languages of the product (data model D6). */
export interface LocalizedName {
  ru: string;
  tj: string;
}

/** Countries of manufacture offered in the product card, ISO 3166-1 alpha-2. */
export const countries: ReadonlyArray<{ code: string; name: LocalizedName }> = [
  { code: 'TJ', name: { ru: 'Таджикистан', tj: 'Тоҷикистон' } },
  { code: 'RU', name: { ru: 'Россия', tj: 'Русия' } },
  { code: 'UZ', name: { ru: 'Узбекистан', tj: 'Ӯзбекистон' } },
  { code: 'KZ', name: { ru: 'Казахстан', tj: 'Қазоқистон' } },
  { code: 'KG', name: { ru: 'Кыргызстан', tj: 'Қирғизистон' } },
  { code: 'BY', name: { ru: 'Беларусь', tj: 'Беларус' } },
  { code: 'UA', name: { ru: 'Украина', tj: 'Украина' } },
  { code: 'TR', name: { ru: 'Турция', tj: 'Туркия' } },
  { code: 'IN', name: { ru: 'Индия', tj: 'Ҳиндустон' } },
  { code: 'CN', name: { ru: 'Китай', tj: 'Чин' } },
  { code: 'DE', name: { ru: 'Германия', tj: 'Олмон' } },
  { code: 'FR', name: { ru: 'Франция', tj: 'Фаронса' } },
  { code: 'PL', name: { ru: 'Польша', tj: 'Лаҳистон' } },
  { code: 'HU', name: { ru: 'Венгрия', tj: 'Маҷористон' } },
  { code: 'SI', name: { ru: 'Словения', tj: 'Словения' } },
  { code: 'AT', name: { ru: 'Австрия', tj: 'Австрия' } },
  { code: 'CH', name: { ru: 'Швейцария', tj: 'Швейтсария' } },
  { code: 'CZ', name: { ru: 'Чехия', tj: 'Чехия' } },
  { code: 'GB', name: { ru: 'Великобритания', tj: 'Британияи Кабир' } },
  { code: 'US', name: { ru: 'США', tj: 'ИМА' } },
  { code: 'IR', name: { ru: 'Иран', tj: 'Эрон' } },
  { code: 'PK', name: { ru: 'Пакистан', tj: 'Покистон' } },
];

export function isCountryCode(value: unknown): boolean {
  return countries.some((country) => country.code === value);
}

/** Categories and dosage forms every new network starts with (spec, section 4). */
export const catalogDefaults: {
  categories: ReadonlyArray<{ name: LocalizedName }>;
  dosageForms: ReadonlyArray<{ code: string; name: LocalizedName }>;
} = {
  categories: [
    { name: { ru: 'Лекарственные средства', tj: 'Маводи доруворӣ' } },
    { name: { ru: 'Витамины и БАД', tj: 'Витаминҳо ва иловаҳои ғизоӣ' } },
    { name: { ru: 'Медицинские изделия', tj: 'Маснуоти тиббӣ' } },
    { name: { ru: 'Гигиена и уход', tj: 'Гигиена ва нигоҳубин' } },
    { name: { ru: 'Детские товары', tj: 'Молҳои кӯдакона' } },
    { name: { ru: 'Прочее', tj: 'Дигар' } },
  ],
  dosageForms: [
    { code: 'tablets', name: { ru: 'Таблетки', tj: 'Ҳабҳо' } },
    { code: 'capsules', name: { ru: 'Капсулы', tj: 'Капсулаҳо' } },
    { code: 'syrup', name: { ru: 'Сироп', tj: 'Шарбат' } },
    { code: 'suspension', name: { ru: 'Суспензия', tj: 'Суспензия' } },
    { code: 'solution', name: { ru: 'Раствор', tj: 'Маҳлул' } },
    { code: 'ointment', name: { ru: 'Мазь', tj: 'Марҳам' } },
    { code: 'cream', name: { ru: 'Крем', tj: 'Крем' } },
    { code: 'gel', name: { ru: 'Гель', tj: 'Гел' } },
    { code: 'drops', name: { ru: 'Капли', tj: 'Қатраҳо' } },
    { code: 'spray', name: { ru: 'Спрей', tj: 'Спрей' } },
    { code: 'powder', name: { ru: 'Порошок', tj: 'Хока' } },
    { code: 'suppositories', name: { ru: 'Суппозитории', tj: 'Шамъчаҳо' } },
    { code: 'ampoules', name: { ru: 'Ампулы', tj: 'Ампулаҳо' } },
  ],
};
