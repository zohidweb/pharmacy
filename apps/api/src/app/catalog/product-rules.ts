import { isCountryCode } from '@pharmacy/shared-domain';
import type { PrescriptionKind } from '@pharmacy/shared-dto';
import {
  type NameLanguage,
  nameMap,
  type ProductValues,
} from './catalog.repository';

// Columns of the stock threshold are integers: packs × pieces must fit.
export const MAX_MIN_STOCK_PIECES = 2_000_000_000;

/** The fields of a card the rules below read: the form of the card and a row of a file load alike. */
export interface CardFields {
  nameRu: string;
  nameTj: string;
  inn: string;
  form: string;
  dosage: string;
  manufacturer: string;
  countryCode: string;
  unit: string;
  piecesPerPack: number;
  divisible: boolean;
  prescription: PrescriptionKind;
  maxPriceMinor: number | null;
  markupPercent: number | null;
  minStockPacks: number;
}

/**
 * The rules of a product card that need no query (spec 2026-10-07-catalog-pricing, section 5; spec
 * 2026-10-20-data-import, 5): the name in the language of the network, a form of the dosage forms of the network, a
 * known country, a divisible pack of 2 pieces at least, the stock threshold, no barcode twice. In the order the form
 * reports them; the card stops at the first, a file load lists them all.
 */
export function cardIssues(
  input: CardFields,
  barcodes: readonly string[],
  context: { language: NameLanguage; forms: ReadonlySet<string> },
): { field: string; code: string }[] {
  const issues: { field: string; code: string }[] = [];
  if (!nameMap(input.nameRu, input.nameTj)[context.language]) {
    issues.push({
      field: context.language === 'tj' ? 'nameTj' : 'nameRu',
      code: 'required',
    });
  }
  if (input.form !== '' && !context.forms.has(input.form)) {
    issues.push({ field: 'form', code: 'unknown_form' });
  }
  if (input.countryCode !== '' && !isCountryCode(input.countryCode)) {
    issues.push({ field: 'countryCode', code: 'unknown_country' });
  }
  if (input.divisible && input.piecesPerPack < 2) {
    issues.push({ field: 'divisible', code: 'not_divisible' });
  }
  if (input.minStockPacks * input.piecesPerPack > MAX_MIN_STOCK_PIECES) {
    issues.push({ field: 'minStockPacks', code: 'max' });
  }
  if (new Set(barcodes).size !== barcodes.length) {
    issues.push({ field: 'barcodes', code: 'duplicate' });
  }
  return issues;
}

/** The columns of a product of a card that passed `cardIssues`. */
export function productValuesOf(
  input: CardFields,
  categoryId: string,
): ProductValues {
  return {
    name: nameMap(input.nameRu, input.nameTj),
    inn: input.inn === '' ? null : { ru: input.inn },
    dosageForm: input.form || null,
    dosage: input.dosage || null,
    manufacturer: input.manufacturer || null,
    country: input.countryCode || null,
    unit: input.unit,
    piecesPerPack: input.piecesPerPack,
    soldByPiece: input.divisible,
    isPrescription: input.prescription !== 'none',
    isControlled: input.prescription === 'controlled',
    isPriceRegulated: input.maxPriceMinor !== null,
    maxRetailPricePerPackDirams: input.maxPriceMinor,
    categoryId,
    markupBp: input.markupPercent === null ? null : input.markupPercent * 100,
    defaultMinStockPieces: input.minStockPacks * input.piecesPerPack,
  };
}
