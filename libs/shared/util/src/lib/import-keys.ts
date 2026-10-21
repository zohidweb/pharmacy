/**
 * The key two names are compared by when data is loaded from a file (spec 2026-10-20-data-import,
 * F9): the case, repeated spaces, the no-break space and «ё» do not matter. One function for the
 * browser and the API, so a row matches the same product on both.
 */
export function matchKey(value: string): string {
  return (
    value
      .normalize('NFC')
      // `\s` covers the no-break space too
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru')
      .replace(/ё/g, 'е')
  );
}
