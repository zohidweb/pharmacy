import { matchKey } from '@pharmacy/shared-util';
import type { Sheet } from '@/shared/lib/spreadsheet';
import { type CatalogExtras, distinctValues } from './build';

export interface ValueItem {
  key: string;
  text: string;
  rows: number;
}

/**
 * The values of the catalog the employee chooses (spec 2026-10-20-data-import, F6). Keys are `matchKey` of the file
 * values; a known category or form is chosen already.
 */
export interface CatalogValueChoices {
  unknownCategories: ValueItem[];
  unknownForms: ValueItem[];
  /** Data rows without a category (all of them when no column is the category). */
  emptyCategories: number;
  /** Key → the name of an active category, or the file text (a new category). */
  categories: Record<string, string>;
  /** Key → a form of the network, or '' (none). */
  forms: Record<string, string>;
  defaultCategory: string;
}

/** The choices a file needs: known values matched without case, a new category by default when it may be created. */
export function initialChoices(
  sheet: Sheet,
  headerRow: number,
  mapping: readonly (string | null)[],
  references: {
    /** Active categories: both names of each, and the name the API matches. */
    categories: readonly { names: readonly string[]; value: string }[];
    forms: readonly string[];
  },
  canCreateCategories: boolean,
  previous: CatalogValueChoices | null = null,
): CatalogValueChoices {
  // a category of the file in either language is the same category (final review, web minor 16)
  const categoryByKey = new Map(
    references.categories.flatMap((category) =>
      category.names.map((name) => [matchKey(name), category.value] as const),
    ),
  );
  const formByKey = new Map(
    references.forms.map((form) => [matchKey(form), form]),
  );
  const fileCategories = distinctValues(sheet, headerRow, mapping, 'category');
  const fileForms = distinctValues(sheet, headerRow, mapping, 'form');

  const categories: Record<string, string> = {};
  const unknownCategories: ValueItem[] = [];
  for (const item of fileCategories.values) {
    const known = categoryByKey.get(item.key);
    if (known) categories[item.key] = known;
    else {
      unknownCategories.push(item);
      // a choice made before going back to the columns stays (final review, web minor 11)
      categories[item.key] =
        previous?.categories[item.key] ??
        (canCreateCategories ? item.text : '');
    }
  }
  const forms: Record<string, string> = {};
  const unknownForms: ValueItem[] = [];
  for (const item of fileForms.values) {
    const known = formByKey.get(item.key);
    if (known) forms[item.key] = known;
    else {
      unknownForms.push(item);
      forms[item.key] = previous?.forms[item.key] ?? '';
    }
  }
  return {
    unknownCategories,
    unknownForms,
    emptyCategories: fileCategories.empty,
    categories,
    forms,
    defaultCategory: previous?.defaultCategory ?? '',
  };
}

export const needsChoices = (choices: CatalogValueChoices): boolean =>
  choices.unknownCategories.length > 0 ||
  choices.unknownForms.length > 0 ||
  choices.emptyCategories > 0;

export const catalogExtrasOf = (
  choices: CatalogValueChoices,
): CatalogExtras => ({
  kind: 'catalog',
  categories: choices.categories,
  forms: choices.forms,
  defaultCategory: choices.defaultCategory,
});
