/*
 * Saving a file the browser built (ADR-0015, amendment 2026-10-27): a link with `download` on an object URL. The URL
 * lives a minute: a large file or a «Save as» dialog may read it after the click returns.
 */
import {
  type XlsxSheet,
  XLSX_MIME_TYPE,
  xlsxBytes,
} from '@pharmacy/shared-util';

const URL_LIFETIME_MS = 60_000;

export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS);
}

/** Writes the sheet as an `.xlsx` file and saves it (plan 2026-10-27-excel-export, X2). */
export async function saveXlsx(
  sheet: XlsxSheet,
  fileName: string,
): Promise<void> {
  const bytes = await xlsxBytes(sheet);
  saveFile(new Blob([bytes], { type: XLSX_MIME_TYPE }), fileName);
}
