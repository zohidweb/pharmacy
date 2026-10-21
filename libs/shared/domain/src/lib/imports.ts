/**
 * Limits of loading data from a file (spec 2026-10-20-data-import, F19), the same for the browser that
 * reads the file and the API that checks the rows.
 */
export const importLimits = {
  /** Size of the .xlsx / .csv the browser reads. */
  fileBytes: 10 * 1024 * 1024,
  /** Data rows of the catalog and of an opening balance. */
  rows: 20_000,
  supplierRows: 2_000,
  /** One unpacked entry of an .xlsx (a zip bomb stops here). */
  unpackedBytes: 100 * 1024 * 1024,
  /** JSON body of the import routes of the API. */
  bodyBytes: 10 * 1024 * 1024,
  /** Refused rows an answer lists; the total is counted apart. */
  issues: 1_000,
  /** Lines of one opening balance draft (the limit of a stock document). */
  documentLines: 500,
} as const;
