import type {
  ReportCell,
  ReportColumn,
  ReportTable,
} from '@pharmacy/shared-dto';
import { type XlsxCell, type XlsxSheet, xlsxCell } from '@pharmacy/shared-util';

type ReportRow = Record<string, ReportCell>;

export interface ReportSheetTexts {
  name: string;
  heading: string[];
  /** The header of the column, with its unit for the counted columns. */
  header: (column: ReportColumn) => string;
  /** The text the screen shows: `text` and `reason` cells, a purged prescription. */
  cell: (column: ReportColumn, value: ReportCell, row: ReportRow) => string;
}

/**
 * A report as a sheet (plan 2026-10-27-excel-export, X10): the columns of the answer; money, counts, percents and dates
 * as numbers of Excel, packs and pieces as whole numbers, the rest as the screen shows it.
 */
export function reportSheet(
  table: ReportTable,
  texts: ReportSheetTexts,
): XlsxSheet {
  const cell = (
    column: ReportColumn,
    value: ReportCell,
    row: ReportRow,
  ): XlsxCell => {
    if (column.key === 'prescription' && row.prescriptionPurged) {
      return xlsxCell.text(texts.cell(column, value, row));
    }
    if (value === null || value === undefined) return null;
    switch (column.type) {
      case 'money':
        return xlsxCell.money(Number(value));
      case 'count':
      case 'quantity':
      case 'pieces':
        return xlsxCell.integer(Number(value));
      case 'percent':
        return xlsxCell.percent(Number(value));
      case 'date':
        return xlsxCell.date(String(value));
      case 'datetime':
        return xlsxCell.dateTime(String(value));
      default:
        return xlsxCell.text(texts.cell(column, value, row));
    }
  };
  const line = (row: ReportRow) =>
    table.columns.map((column) => cell(column, row[column.key], row));
  return {
    name: texts.name,
    heading: texts.heading,
    columns: table.columns.map(texts.header),
    rows: table.rows.map(line),
    total: table.total ? line(table.total) : undefined,
  };
}
