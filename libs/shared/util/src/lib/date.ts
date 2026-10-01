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

const isoDateInZone = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) of an instant in Asia/Dushanbe; defaults to now. */
export function toAppDate(instant: Date = new Date()): string {
  return isoDateInZone.format(instant);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const toUtc = (value: string) => {
    const match = DATE_ONLY.exec(value);
    if (!match)
      throw new RangeError(`Expected a YYYY-MM-DD date, got "${value}"`);
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}
