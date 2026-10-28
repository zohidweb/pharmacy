/** The page size of a list whose request names no `limit` (REST conventions: limit/offset). */
export const DEFAULT_PAGE_LIMIT = 20;

/**
 * The largest page of a list screen. A list that serves the Excel export takes up to `EXPORT_ROW_LIMIT` rows, but past
 * this size only with the export permission of its module (ADR-0015, amendment 2026-10-27).
 */
export const MAX_PAGE_LIMIT = 100;
