import type {
  CatalogImportCheck,
  CatalogImportResult,
  OpeningBalanceImportCheck,
  OpeningBalanceImportResult,
  SupplierImportCheck,
  SupplierImportResult,
} from '@pharmacy/shared-dto';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import type { ImportRequest } from './build';
import type { ImportKindKey } from './fields';

/** A load of 20 000 rows takes longer than the 15 s of a usual request (F19). */
export const IMPORT_TIMEOUT_MS = 120_000;

export type ImportCheck =
  | { kind: 'catalog'; check: CatalogImportCheck }
  | { kind: 'opening-balances'; check: OpeningBalanceImportCheck }
  | { kind: 'suppliers'; check: SupplierImportCheck };

export type ImportResult =
  | { kind: 'catalog'; result: CatalogImportResult }
  | { kind: 'opening-balances'; result: OpeningBalanceImportResult }
  | { kind: 'suppliers'; result: SupplierImportResult };

/** The route a kind of load is for: the journal it opens after the load. */
export const kindPages: Record<ImportKindKey, string> = {
  catalog: routes.catalog(),
  'opening-balances': routes.openingBalances(),
  suppliers: routes.suppliers(),
};

/** The dry run of the API (spec 2026-10-20-data-import, F7). */
export async function checkImport(
  request: ImportRequest,
): Promise<ImportCheck> {
  const options = { timeoutMs: IMPORT_TIMEOUT_MS };
  switch (request.kind) {
    case 'catalog':
      return {
        kind: 'catalog',
        check: await apiRequest('catalogImports.check', {
          ...options,
          body: request.body,
        }),
      };
    case 'opening-balances':
      return {
        kind: 'opening-balances',
        check: await apiRequest('openingBalanceImports.check', {
          ...options,
          body: request.body,
        }),
      };
    case 'suppliers':
      return {
        kind: 'suppliers',
        check: await apiRequest('supplierImports.check', {
          ...options,
          body: request.body,
        }),
      };
  }
}

/** The load: the same rows with the key of this check, so a repeat returns the first answer (F15). */
export async function applyImport(
  request: ImportRequest,
  idempotencyKey: string,
): Promise<ImportResult> {
  const options = { timeoutMs: IMPORT_TIMEOUT_MS, idempotencyKey };
  switch (request.kind) {
    case 'catalog':
      return {
        kind: 'catalog',
        result: await apiRequest('catalogImports.apply', {
          ...options,
          body: request.body,
        }),
      };
    case 'opening-balances':
      return {
        kind: 'opening-balances',
        result: await apiRequest('openingBalanceImports.apply', {
          ...options,
          body: request.body,
        }),
      };
    case 'suppliers':
      return {
        kind: 'suppliers',
        result: await apiRequest('supplierImports.apply', {
          ...options,
          body: request.body,
        }),
      };
  }
}
