/*
 * REST contract of loading the data of a network from a file (spec 2026-10-20-data-import): the
 * browser reads the .xlsx / .csv itself and sends typed rows (F3, F4); the API checks them (a dry
 * run) and loads them all or nothing (F7). Amounts are integer dirams, TJS only (ADR-0016).
 *
 * Every kind has two routes: `POST /<kind>-imports/checks` (200, the check) and `POST /<kind>-imports`
 * with an `Idempotency-Key` (201, the same check in the transaction, then the writes). An error found
 * while loading — 422 `import_invalid`, nothing is written (the screen repeats the check); the key
 * with other rows — 409 `idempotency_conflict`.
 */
import type { ProductUnit } from '@pharmacy/shared-domain';
import type { PrescriptionKind } from './tenant-pos.js';

/**
 * Why a row is refused. `barcode_scientific` and `invalid` are found only by the browser while
 * reading a cell (a barcode written as `4,6E+12`, a value that is not a number or a date), as is the
 * warning `name_only` (a row with a name only — a group or a total of a list); the API never sends
 * them.
 */
export type ImportIssueCode =
  | 'required'
  | 'duplicate_in_file'
  | 'barcode_conflict'
  | 'unknown_category'
  | 'archived_category'
  | 'unknown_form'
  | 'unknown_country'
  | 'not_divisible'
  | 'max'
  | 'product_not_found'
  | 'product_ambiguous'
  | 'product_archived'
  | 'barcode_scientific'
  | 'invalid'
  | 'name_only';

/** A refused row: `line` — the row of the sheet as Excel shows it; `field` — a field of the row. */
export interface ImportIssue {
  line: number;
  field: string | null;
  code: ImportIssueCode;
  /** A name the message shows, e.g. the product that holds the barcode (`barcode_conflict`). */
  detail?: string;
}

/**
 * A row of the catalog (F6, F8, F9): `category` — the name of an active category or of a new one
 * (created with `catalog:update`); `form` — a value of the dosage forms of the network or ''.
 */
export interface CatalogImportRow {
  line: number;
  nameRu: string;
  nameTj: string;
  barcodes: string[];
  category: string;
  form: string;
  dosage: string;
  inn: string;
  manufacturer: string;
  countryCode: string;
  unit: ProductUnit;
  piecesPerPack: number;
  divisible: boolean;
  prescription: PrescriptionKind;
  maxPriceMinor: number | null;
  markupPercent: number | null;
  minStockPacks: number;
}

export interface CatalogImportRequest {
  fileName: string;
  rows: CatalogImportRow[];
}

/** `existing` — rows whose barcodes (or name, form and dosage) are already in the catalog (F8). */
export interface CatalogImportCheck {
  total: number;
  create: number;
  existing: number;
  newCategories: string[];
  errors: ImportIssue[];
  errorsTotal: number;
}

export interface CatalogImportResult {
  importId: string;
  created: number;
  existing: number;
  categoriesCreated: number;
}

/**
 * A row of the opening balance of a store (F9–F11): the product is found by a barcode, else by the
 * name (with the form and the dosage when given); an empty `batchNumber` — the «starting batch».
 */
export interface OpeningBalanceImportRow {
  line: number;
  barcodes: string[];
  name: string;
  form: string;
  dosage: string;
  batchNumber: string;
  /** YYYY-MM-DD. */
  expiresOn: string;
  /** Whole packs, ≥ 1 (rows with 0 are dropped by the browser). */
  quantity: number;
  /** Per pack. */
  costMinor: number;
  /** Per pack; null — the price of the store does not change. */
  retailPriceMinor: number | null;
}

/**
 * The rows become drafts of opening balances of 500 lines (F10); `comment` — in the language of the
 * interface, the API adds ` (i/n)` when there is more than one draft (clarification У4).
 */
export interface OpeningBalanceImportRequest {
  fileName: string;
  storeId: string;
  /** YYYY-MM-DD. */
  date: string;
  comment: string;
  rows: OpeningBalanceImportRow[];
}

/**
 * Warnings that do not stop the load (F13): the store already has stock movements; the same rows were
 * loaded into this store before.
 */
export interface OpeningBalanceImportCheck {
  total: number;
  documents: number;
  storeHasStock: boolean;
  previousImports: {
    importId: string;
    createdAt: string;
    documentNumbers: string[];
  }[];
  errors: ImportIssue[];
  errorsTotal: number;
}

export interface OpeningBalanceImportResult {
  importId: string;
  documents: { id: string; number: string; lines: number }[];
}

export interface SupplierImportRow {
  line: number;
  name: string;
  /** 9 digits or ''. */
  taxId: string;
  phone: string;
  address: string;
  paymentDelayDays: number;
}

export interface SupplierImportRequest {
  fileName: string;
  rows: SupplierImportRow[];
}

/** `existing` — suppliers with the same name, any case (F8). */
export interface SupplierImportCheck {
  total: number;
  create: number;
  existing: number;
  errors: ImportIssue[];
  errorsTotal: number;
}

export interface SupplierImportResult {
  importId: string;
  created: number;
  existing: number;
}
