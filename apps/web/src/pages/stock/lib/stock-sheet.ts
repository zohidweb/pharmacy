import type { StockState } from '@pharmacy/shared-domain';
import type { ReorderLine, StockRow } from '@pharmacy/shared-dto';
import { type XlsxSheet, xlsxCell } from '@pharmacy/shared-util';

export interface StockSheetTexts {
  name: string;
  heading: string[];
  columns: {
    product: string;
    barcode: string;
    store: string;
    controlled: string;
    batch: string;
    expiresOn: string;
    quantity: string;
    perPack: string;
    min: string;
    cost: string;
    price: string;
    state: string;
  };
  /** «ПКУ» in the column of the controlled products. */
  controlled: string;
  state: (state: StockState) => string;
}

/**
 * Stock as a sheet (plan 2026-10-27-excel-export, X10): a row per batch as on the screen; quantities in pieces with the
 * pieces of a pack, so the packs can be counted in Excel; the cost only with `finance:view-cost`.
 */
export function stockSheet(
  rows: readonly StockRow[],
  texts: StockSheetTexts,
  options: { canSeeCost: boolean },
): XlsxSheet {
  const c = texts.columns;
  return {
    name: texts.name,
    heading: texts.heading,
    columns: [
      c.product,
      c.barcode,
      c.store,
      c.controlled,
      c.batch,
      c.expiresOn,
      c.quantity,
      c.perPack,
      c.min,
      ...(options.canSeeCost ? [c.cost] : []),
      c.price,
      c.state,
    ],
    rows: rows.map((row) => [
      xlsxCell.text(row.productName),
      xlsxCell.text(row.barcode),
      xlsxCell.text(row.storeName),
      xlsxCell.text(
        row.prescription === 'controlled' ? texts.controlled : null,
      ),
      xlsxCell.text(row.batchNumber),
      xlsxCell.date(row.expiresOn),
      xlsxCell.integer(row.quantityPieces),
      xlsxCell.integer(row.piecesPerPack),
      xlsxCell.integer(row.minPieces),
      ...(options.canSeeCost ? [xlsxCell.money(row.costMinor)] : []),
      xlsxCell.money(row.retailPriceMinor),
      xlsxCell.text(texts.state(row.state)),
    ]),
  };
}

export interface ReorderSheetTexts {
  name: string;
  heading: string[];
  columns: {
    product: string;
    store: string;
    stock: string;
    min: string;
    shortage: string;
    perPack: string;
  };
}

/** «Надо заказать» as a sheet (plan 2026-10-27-excel-export, X10). */
export function reorderSheet(
  lines: readonly ReorderLine[],
  texts: ReorderSheetTexts,
): XlsxSheet {
  const c = texts.columns;
  return {
    name: texts.name,
    heading: texts.heading,
    columns: [c.product, c.store, c.stock, c.min, c.shortage, c.perPack],
    rows: lines.map((line) => [
      xlsxCell.text(line.productName),
      xlsxCell.text(line.storeName),
      xlsxCell.integer(line.stockPieces),
      xlsxCell.integer(line.minPieces),
      xlsxCell.integer(line.shortagePieces),
      xlsxCell.integer(line.piecesPerPack),
    ]),
  };
}
