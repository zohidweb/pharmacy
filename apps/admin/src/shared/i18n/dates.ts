'use client';

import { useTranslations } from 'use-intl';

// Month names and «… ago» come from the dictionaries, not Intl: browsers ship no Tajik locale data, so
// Intl falls back to Russian under TJ (QA 2026-10-28).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** «октябрь 2026 г.» / «октябр 2026» from a YYYY-MM period. */
export function useMonthYear(): (period: string) => string {
  const t = useTranslations('common');
  return (period) => {
    const [year, month] = period.split('-');
    return t('monthYear', {
      month: t(`months.${Number(month)}` as 'months.1'),
      year,
    });
  };
}

/** «2 месяца назад» / «2 моҳ пеш»; a moment in the future reads as now. */
export function useTimeAgo(): (moment: Date, now?: Date) => string {
  const t = useTranslations('common.ago');
  return (moment, now = new Date()) => {
    const elapsed = now.getTime() - moment.getTime();
    if (elapsed < MINUTE) return t('now');
    if (elapsed < HOUR)
      return t('minutes', { count: Math.floor(elapsed / MINUTE) });
    if (elapsed < DAY) return t('hours', { count: Math.floor(elapsed / HOUR) });
    if (elapsed < MONTH) return t('days', { count: Math.floor(elapsed / DAY) });
    if (elapsed < YEAR)
      return t('months', { count: Math.floor(elapsed / MONTH) });
    return t('years', { count: Math.floor(elapsed / YEAR) });
  };
}
