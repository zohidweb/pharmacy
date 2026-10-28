import type { StockRow } from '@pharmacy/shared-dto';

/** What a price tag of the shelf shows (plan 2026-10-28-price-tags-qr, T3). */
export interface PriceTagData {
  name: string;
  /** «производитель · страна · уп. N шт.» or «уп. N шт.» */
  details: string;
  /** The first barcode of the product; null — none. */
  barcode: string | null;
  /** The price of a pack at the store. */
  priceMinor: number;
}

/**
 * The tags of selected stock rows (T7): one per store × product — a product has a row per batch — with its price at
 * that store; a pair without a price is not printed and counted.
 */
export function stockTags(
  rows: readonly StockRow[],
  pack: (pieces: number) => string,
): { tags: PriceTagData[]; skipped: number } {
  const pairs = new Map<string, PriceTagData | null>();
  for (const row of rows) {
    const key = `${row.storeId}/${row.productId}`;
    if (pairs.has(key)) continue;
    pairs.set(
      key,
      row.retailPriceMinor === null
        ? null
        : {
            name: row.productName,
            details: pack(row.piecesPerPack),
            barcode: row.barcode,
            priceMinor: row.retailPriceMinor,
          },
    );
  }
  const all = [...pairs.values()];
  return {
    tags: all.filter((tag): tag is PriceTagData => tag !== null),
    skipped: all.filter((tag) => tag === null).length,
  };
}
