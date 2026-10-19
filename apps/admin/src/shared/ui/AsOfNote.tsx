'use client';

import { formatDateTime, toAppDate } from '@pharmacy/shared-util';
import { useTranslations } from 'use-intl';

/**
 * «Данные на 14:05» — when the statistics marts shown were refreshed (spec
 * 2026-10-19-admin-dashboard-stats, D7): the time today, the date and time otherwise; nothing when
 * no network has been refreshed yet.
 */
export function AsOfNote({ at }: { at: string | null }) {
  const t = useTranslations('shell.asOf');
  if (at === null) return null;
  // '21.09.2026, 11:42' in Asia/Dushanbe
  const text = formatDateTime(at);
  return (
    <p className="text-xs text-fg-subtle">
      {toAppDate(new Date(at)) === toAppDate()
        ? t('today', { time: text.slice(-5) })
        : t('earlier', { at: text })}
    </p>
  );
}
