/*
 * Other expenses of the network (spec 2026-10-14-owner-cabinet, O4, O5, E16): the owner enters the
 * rent, salaries and utilities of a month; a report over a part of the month takes the share of its
 * days. Money in dirams, months as YYYY-MM, dates as YYYY-MM-DD.
 */

export const expenseKinds = ['rent', 'salary', 'utilities', 'other'] as const;

export type ExpenseKind = (typeof expenseKinds)[number];

const DAY_MS = 86_400_000;

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** The days of a month YYYY-MM. */
export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/**
 * The share of an expense of `month` in the period [from, to] (both included):
 * amount × days of the overlap / days of the month, half up, in whole dirams. Each record is
 * rounded on its own, so a period covering the month gives the whole amount.
 */
export function prorateExpense(
  amountMinor: number,
  month: string,
  from: string,
  to: string,
): number {
  const days = daysInMonth(month);
  const first = dayOf(`${month}-01`);
  const last = first + days - 1;
  const overlap =
    Math.min(dayOf(to), last) - Math.max(dayOf(from), first) + 1;
  if (overlap <= 0) return 0;
  return Math.floor((2 * amountMinor * overlap + days) / (2 * days));
}
