/**
 * Dates: dd.MM.yyyy and 24h HH:mm for both RU and TJ, always in Asia/Dushanbe (UTC+5, no DST),
 * never the terminal PC's time zone.
 */
export const APP_TIME_ZONE = 'Asia/Dushanbe';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a date-only value ('2026-11-12' → '12.11.2026') without going through Date,
 * so expiry dates and "paid until" never shift by a day.
 */
export function formatDateOnly(isoDate: string): string {
  const match = DATE_ONLY.exec(isoDate);
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DD date, got "${isoDate}"`);
  }
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Formats an ISO instant ('2026-09-21T06:42:00Z' → '21.09.2026, 11:42'). */
export function formatDateTime(isoInstant: string): string {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Expected an ISO date-time, got "${isoInstant}"`);
  }
  return dateTimeFormat.format(date);
}
