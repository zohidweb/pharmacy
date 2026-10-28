import type { StoreMode, UsageStatsResponse } from '@pharmacy/shared-dto';
import { type XlsxSheet, xlsxCell } from '@pharmacy/shared-util';

export interface StatsSheetTexts {
  name: string;
  heading: string[];
  columns: {
    tenant: string;
    store: string;
    mode: string;
    receipts: string;
    sales: string;
    average: string;
    activity: string;
  };
  mode: (mode: StoreMode) => string;
}

/**
 * The usage statistics as a sheet (plan 2026-10-27-excel-export, X10): a row of the company, then its stores with the
 * company repeated, so the auto filter keeps a company together; the store column of a company row stays empty.
 */
export function statsSheet(
  data: UsageStatsResponse,
  texts: StatsSheetTexts,
): XlsxSheet {
  const c = texts.columns;
  return {
    name: texts.name,
    heading: texts.heading,
    columns: [
      c.tenant,
      c.store,
      c.mode,
      c.receipts,
      c.sales,
      c.average,
      c.activity,
    ],
    rows: data.rows.flatMap((tenant) => [
      [
        xlsxCell.text(tenant.tenantName),
        null,
        null,
        xlsxCell.integer(tenant.receipts),
        xlsxCell.money(tenant.salesMinor),
        xlsxCell.money(tenant.averageReceiptMinor),
        xlsxCell.dateTime(tenant.lastActivityAt),
      ],
      ...tenant.stores.map((store) => [
        xlsxCell.text(tenant.tenantName),
        xlsxCell.text(store.storeName),
        xlsxCell.text(texts.mode(store.mode)),
        xlsxCell.integer(store.receipts),
        xlsxCell.money(store.salesMinor),
        xlsxCell.money(store.averageReceiptMinor),
        xlsxCell.dateTime(store.lastActivityAt),
      ]),
    ]),
  };
}
