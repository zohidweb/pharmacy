import type { TenantAuditEntry } from '@pharmacy/shared-dto';
import { type XlsxSheet, xlsxCell } from '@pharmacy/shared-util';

export interface AuditSheetTexts {
  name: string;
  heading: string[];
  /** at, document date, employee, store, action, object, details, source */
  columns: string[];
  /** The title and the details the screen builds of the code and the values (spec 2026-10-14-owner-cabinet, E7). */
  entry: (entry: TenantAuditEntry) => { title: string; details: string };
  /** «Сеть» — an entry without a store. */
  network: string;
  /** «Оператор» — an action of the platform operator. */
  operator: string;
}

/** The journal as a sheet (plan 2026-10-27-excel-export, X10): the columns of the screen, the time as a date of Excel. */
export function auditSheet(
  entries: readonly TenantAuditEntry[],
  texts: AuditSheetTexts,
): XlsxSheet {
  return {
    name: texts.name,
    heading: texts.heading,
    columns: texts.columns,
    rows: entries.map((row) => {
      const text = texts.entry(row);
      return [
        xlsxCell.dateTime(row.at),
        xlsxCell.date(row.documentDate),
        xlsxCell.text(row.employeeName),
        xlsxCell.text(row.storeName ?? texts.network),
        xlsxCell.text(text.title),
        xlsxCell.text(row.object),
        xlsxCell.text(text.details),
        xlsxCell.text(row.byOperator ? texts.operator : null),
      ];
    }),
  };
}
