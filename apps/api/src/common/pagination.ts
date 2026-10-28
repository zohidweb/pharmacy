import { SetMetadata } from '@nestjs/common';

/** The page size of a list whose request names no `limit` (REST conventions: limit/offset). */
export const DEFAULT_PAGE_LIMIT = 20;

/**
 * The largest page of a list screen. A list that serves the Excel export takes up to `EXPORT_ROW_LIMIT` rows, but past
 * this size only with the export permission of its module (ADR-0015, amendment 2026-10-27).
 */
export const MAX_PAGE_LIMIT = 100;

export const EXPORT_PAGE = 'pharmacy:export-page';

/**
 * Marks a list route whose page may exceed `MAX_PAGE_LIMIT` for the Excel export: such a page also counts against the
 * small `export` throttle (app.module.ts). Other routes with large pages (stock products, the sync feed) are not
 * exports and keep the default budget only.
 */
export const ExportPage = () => SetMetadata(EXPORT_PAGE, true);
