import type {
  CatalogProductInput,
  CatalogReferences,
  DrugReferenceItem,
} from '@pharmacy/shared-dto';

const fold = (value: string) =>
  value.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');

/**
 * «Заполнить» from the platform drug reference (plan 2026-11-11-drug-reference-seed, R12): names, МНН, dosage and
 * manufacturer when the reference gives them; the form only when the network has it; the country only when the list
 * has it; the dispensing; the reference barcodes join those already typed. Category, unit, packing, prices and the
 * minimum stock stay as they are.
 */
export function fillFromReference<Draft extends CatalogProductInput>(
  draft: Draft,
  entry: DrugReferenceItem,
  refs: Pick<CatalogReferences, 'forms' | 'countries'>,
): Draft {
  const given = (value: string, current: string) =>
    value.trim() === '' ? current : value;
  const form =
    entry.form === ''
      ? undefined
      : refs.forms.find((value) => fold(value) === fold(entry.form));
  const country = refs.countries.some((c) => c.code === entry.countryCode)
    ? entry.countryCode
    : draft.countryCode;
  const typed = new Set(draft.barcodes.map((barcode) => barcode.code));
  return {
    ...draft,
    nameRu: given(entry.nameRu, draft.nameRu),
    nameTj: given(entry.nameTj, draft.nameTj),
    inn: given(entry.inn, draft.inn),
    form: form ?? draft.form,
    dosage: given(entry.dosage, draft.dosage),
    manufacturer: given(entry.manufacturer, draft.manufacturer),
    countryCode: country,
    prescription: entry.prescription,
    barcodes: [
      ...draft.barcodes,
      ...entry.barcodes
        .filter((code) => !typed.has(code))
        .map((code) => ({ code })),
    ],
  };
}
