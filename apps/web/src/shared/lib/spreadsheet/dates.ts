const DAY_MS = 86_400_000;

/**
 * A date cell of an .xlsx is a serial number of days (spec 2026-10-20-data-import, 3.2): in the 1900 system 1 is
 * 1900-01-01 and Excel counts a 1900-02-29 that never was (60), in the 1904 system 0 is 1904-01-01. The time of
 * the day is dropped. YYYY-MM-DD, or null outside the years 1900–9999.
 */
export function excelSerialToDate(
  serial: number,
  date1904: boolean,
): string | null {
  if (!Number.isFinite(serial)) return null;
  const days = Math.floor(serial);
  let ms: number;
  if (date1904) {
    if (days < 0) return null;
    ms = Date.UTC(1904, 0, 1) + days * DAY_MS;
  } else {
    if (days < 1 || days === 60) return null;
    ms =
      (days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)) +
      days * DAY_MS;
  }
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 9999) return null;
  return date.toISOString().slice(0, 10);
}
