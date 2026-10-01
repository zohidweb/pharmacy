/*
 * In-memory index of the store catalog snapshot (ADR-0015): Map<barcode, product> for the scanner,
 * search by name / МНН / barcode, analogs by МНН, FEFO order of batches. Text is NFC-normalized and
 * case-folded once at build time; a search is a linear scan over a few thousand products.
 */
import type {
  CatalogSnapshot,
  PosBatch,
  PosProduct,
} from '@pharmacy/shared-dto';

/** Batch expiring within this many days is shown as «истекает». */
export const EXPIRING_DAYS = 30;

export type BatchState = 'ok' | 'expiring' | 'expired' | 'empty';

const fold = (text: string) => text.normalize('NFC').toLocaleLowerCase('ru');

export interface CatalogIndex {
  version: number;
  products: readonly PosProduct[];
  byId: ReadonlyMap<string, PosProduct>;
  byBarcode: ReadonlyMap<string, PosProduct>;
  search: (query: string, categoryId?: string | null) => PosProduct[];
  /** Products with the same МНН that can be sold today. */
  analogsOf: (product: PosProduct, today: string) => PosProduct[];
}

export function buildCatalogIndex(snapshot: CatalogSnapshot): CatalogIndex {
  const byId = new Map(snapshot.products.map((p) => [p.id, p]));
  const byBarcode = new Map<string, PosProduct>();
  const haystack = new Map<string, string>();
  for (const product of snapshot.products) {
    for (const code of product.barcodes) byBarcode.set(code, product);
    haystack.set(
      product.id,
      fold([product.name, product.inn ?? '', ...product.barcodes].join(' ')),
    );
  }
  return {
    version: snapshot.version,
    products: snapshot.products,
    byId,
    byBarcode,
    search: (query, categoryId = null) => {
      const words = fold(query).split(/\s+/).filter(Boolean);
      return snapshot.products.filter(
        (product) =>
          (!categoryId || product.categoryId === categoryId) &&
          words.every((word) => haystack.get(product.id)?.includes(word)),
      );
    },
    analogsOf: (product, today) =>
      product.inn
        ? snapshot.products.filter(
            (other) =>
              other.id !== product.id &&
              other.inn === product.inn &&
              fefoBatches(other, today).length > 0,
          )
        : [],
  };
}

/** Applies a delta snapshot (changed products and removed ids) to the stored full snapshot. */
export function mergeSnapshot(
  stored: CatalogSnapshot | null,
  incoming: CatalogSnapshot,
): CatalogSnapshot {
  if (incoming.full || !stored) return incoming;
  const removed = new Set(incoming.removedProductIds);
  const changed = new Map(incoming.products.map((p) => [p.id, p]));
  return {
    ...incoming,
    full: true,
    products: [
      ...stored.products.filter(
        (p) => !removed.has(p.id) && !changed.has(p.id),
      ),
      ...incoming.products,
    ],
  };
}

export function batchState(batch: PosBatch, today: string): BatchState {
  if (batch.expiresOn < today) return 'expired';
  if (batch.quantityPieces <= 0) return 'empty';
  const days =
    (Date.parse(`${batch.expiresOn}T00:00:00Z`) -
      Date.parse(`${today}T00:00:00Z`)) /
    86_400_000;
  return days <= EXPIRING_DAYS ? 'expiring' : 'ok';
}

/** Sellable batches, nearest expiry first (FEFO); expired batches are never sold. */
export function fefoBatches(product: PosProduct, today: string): PosBatch[] {
  return product.batches
    .filter((b) => b.expiresOn >= today && b.quantityPieces > 0)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

/** Pieces that can be sold today (expired batches excluded). */
export function sellablePieces(product: PosProduct, today: string): number {
  return fefoBatches(product, today).reduce(
    (sum, b) => sum + b.quantityPieces,
    0,
  );
}
