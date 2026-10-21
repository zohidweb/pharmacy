import type { ImportIssue } from '@pharmacy/shared-dto';
import { type ImportKindKey, kindFields } from './fields';

/** A CSV Excel opens as is in Russian Windows: UTF-8 with a BOM, `;` between the cells, CRLF. */
function csvBlob(rows: readonly (readonly string[])[]): Blob {
  const cell = (value: string) =>
    /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const text = rows.map((row) => row.map(cell).join(';')).join('\r\n');
  return new Blob(['\ufeff', text, '\r\n'], { type: 'text/csv;charset=utf-8' });
}

/** The template of a kind (F5): one row of the headers, in the language of the interface. */
export function templateCsv(
  kind: ImportKindKey,
  label: (field: string) => string,
): Blob {
  return csvBlob([kindFields[kind].map((field) => label(field.key))]);
}

/** The refused rows (the step «Check»): row, column, message. */
export function issuesCsv(
  head: readonly [string, string, string],
  issues: readonly ImportIssue[],
  columnOf: (issue: ImportIssue) => string,
  message: (issue: ImportIssue) => string,
): Blob {
  return csvBlob([
    head,
    ...issues.map((issue) => [
      String(issue.line),
      columnOf(issue),
      message(issue),
    ]),
  ]);
}

/** Saves a blob as a file of the browser. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
