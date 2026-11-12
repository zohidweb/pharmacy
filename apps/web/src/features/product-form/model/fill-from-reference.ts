import type {
  CatalogProductInput,
  CatalogReferences,
  DrugReferenceItem,
  PrescriptionKind,
} from '@pharmacy/shared-dto';

/** As `ArrayMaxSize` of the product card in the API. */
export const MAX_PRODUCT_BARCODES = 20;

const FILLED_FIELDS = [
  'nameRu',
  'nameTj',
  'inn',
  'form',
  'dosage',
  'manufacturer',
  'countryCode',
  'prescription',
] as const;
type FilledField = (typeof FILLED_FIELDS)[number];
type FilledValues = Pick<CatalogProductInput, FilledField>;

/** What one «Заполнить» changed: undone before the next one, so two entries never mix. */
export interface ReferenceFill {
  before: FilledValues;
  after: FilledValues;
  /** Barcodes the fill added (not those typed or scanned before it). */
  added: string[];
}

const RANK: Record<PrescriptionKind, number> = {
  none: 0,
  rx: 1,
  controlled: 2,
};

const fold = (value: string) =>
  value.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');

const valuesOf = <Draft extends CatalogProductInput>(
  draft: Draft,
): FilledValues =>
  Object.fromEntries(
    FILLED_FIELDS.map((key) => [key, draft[key]]),
  ) as FilledValues;

/**
 * Takes back the previous «Заполнить»: a field still holding what it set gets its earlier value; its barcodes go.
 * A field the user changed after the fill keeps the user's value.
 */
function undo<Draft extends CatalogProductInput>(
  draft: Draft,
  fill: ReferenceFill,
): Draft {
  const restored = { ...draft };
  for (const key of FILLED_FIELDS) {
    if (draft[key] === fill.after[key]) {
      (restored as FilledValues)[key] = fill.before[key] as never;
    }
  }
  const added = new Set(fill.added);
  restored.barcodes = draft.barcodes.filter(
    (barcode) => !added.has(barcode.code),
  );
  return restored;
}

/**
 * «Заполнить» from the platform drug reference (plan 2026-11-11-drug-reference-seed, R12):
 * - names, МНН, dosage and manufacturer when the reference gives them; a name still equal to the text the product
 *   started from (a search typed in a document) is replaced even by an empty value — a fragment is not a name;
 * - the form only when the network has it; the country only when the list has it;
 * - the dispensing never goes down: `none` in the reference also means «not given»;
 * - the reference barcodes join those already there, up to the limit of the card;
 * - category, unit, packing, prices and the minimum stock stay as they are.
 * The previous fill is undone first, so a second «Заполнить» replaces the first instead of mixing two entries.
 */
export function fillFromReference<Draft extends CatalogProductInput>(
  current: Draft,
  entry: DrugReferenceItem,
  refs: Pick<CatalogReferences, 'forms' | 'countries'>,
  options: { previous: ReferenceFill | null; seed: string },
): { draft: Draft; fill: ReferenceFill } {
  const draft = options.previous ? undo(current, options.previous) : current;
  const seed = options.seed.trim();
  const given = (value: string, now: string) =>
    value.trim() === '' ? now : value;
  const name = (value: string, now: string) =>
    seed !== '' && now.trim() === seed ? value : given(value, now);
  const form =
    entry.form === ''
      ? undefined
      : refs.forms.find((value) => fold(value) === fold(entry.form));
  const country = refs.countries.some((c) => c.code === entry.countryCode)
    ? entry.countryCode
    : draft.countryCode;
  const prescription =
    RANK[entry.prescription] > RANK[draft.prescription]
      ? entry.prescription
      : draft.prescription;
  const present = new Set(draft.barcodes.map((barcode) => barcode.code));
  const added = entry.barcodes
    .filter((code) => !present.has(code))
    .slice(0, Math.max(0, MAX_PRODUCT_BARCODES - draft.barcodes.length));

  const next: Draft = {
    ...draft,
    nameRu: name(entry.nameRu, draft.nameRu),
    nameTj: name(entry.nameTj, draft.nameTj),
    inn: given(entry.inn, draft.inn),
    form: form ?? draft.form,
    dosage: given(entry.dosage, draft.dosage),
    manufacturer: given(entry.manufacturer, draft.manufacturer),
    countryCode: country,
    prescription,
    barcodes: [...draft.barcodes, ...added.map((code) => ({ code }))],
  };
  return {
    draft: next,
    fill: { before: valuesOf(draft), after: valuesOf(next), added },
  };
}
