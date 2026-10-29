import { formatDateOnly, toAppDate } from '@pharmacy/shared-util';

/**
 * The publication date of an article (W8): the calendar date of the instant in Dushanbe — `date` for
 * `<time dateTime>`, `label` as dd.MM.yyyy.
 */
export function publicationDate(instant: string): {
  date: string;
  label: string;
} {
  const date = toAppDate(new Date(instant));
  return { date, label: formatDateOnly(date) };
}
