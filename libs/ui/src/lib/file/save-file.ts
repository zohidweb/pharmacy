/*
 * Saving a file the browser built (ADR-0015, amendment 2026-10-27): a link with `download` on an object URL; the URL is
 * revoked on the next tick, after the browser has taken the file.
 */
import {
  type XlsxSheet,
  XLSX_MIME_TYPE,
  xlsxBytes,
} from '@pharmacy/shared-util';

export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Writes the sheet as an `.xlsx` file and saves it (plan 2026-10-27-excel-export, X2). */
export async function saveXlsx(
  sheet: XlsxSheet,
  fileName: string,
): Promise<void> {
  const bytes = await xlsxBytes(sheet);
  saveFile(new Blob([bytes], { type: XLSX_MIME_TYPE }), fileName);
}
