import type { DashboardPeriod } from '@pharmacy/shared-dto';
import {
  FieldProblemException,
  ValidationFailedException,
} from '../../common/errors/validation-failed.exception';

/** The longest own period of the home (spec 2026-10-14-owner-cabinet, E1). */
export const MAX_CUSTOM_DAYS = 92;

export interface DashboardDates {
  from: string;
  to: string;
  /** The segment of the same length right before the period. */
  prevFrom: string;
  prevTo: string;
  /** The days of the chart (E6). */
  chartFrom: string;
  chartTo: string;
}

export function addDays(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  );
}

/**
 * The dates of a period of the home (E1, E6): business dates of the network, both ends included.
 * `custom` needs both dates (400), not after today and not longer than 92 days (422).
 */
export function resolveDashboardPeriod(
  period: DashboardPeriod,
  today: string,
  from?: string,
  to?: string,
): DashboardDates {
  let start: string;
  let end = today;
  let chartFrom: string;
  if (period === 'today') {
    start = today;
    chartFrom = addDays(today, -6);
  } else if (period === 'week') {
    start = addDays(today, -6);
    chartFrom = start;
  } else if (period === 'month') {
    start = `${today.slice(0, 8)}01`;
    chartFrom = start;
  } else {
    if (!from || !to) {
      throw new ValidationFailedException([
        { field: from ? 'to' : 'from', code: 'required' },
      ]);
    }
    if (from > to || to > today || daysBetween(from, to) >= MAX_CUSTOM_DAYS) {
      throw new FieldProblemException(422, 'validation_failed', [
        { field: 'from', code: 'range' },
      ]);
    }
    start = from;
    end = to;
    chartFrom = from;
  }
  const length = daysBetween(start, end) + 1;
  return {
    from: start,
    to: end,
    prevFrom: addDays(start, -length),
    prevTo: addDays(start, -1),
    chartFrom,
    chartTo: end,
  };
}
