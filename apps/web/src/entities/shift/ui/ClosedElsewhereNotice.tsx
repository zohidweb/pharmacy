'use client';

import type { Shift } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import { Alert } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { useClosedElsewhere } from '../api/use-closed-elsewhere';

/**
 * «Смена … закрыта с другого компьютера» on the POS and shift screens of a till without an open shift (plan
 * 2026-10-27-shift-history, S5): its last shift was closed by a manager while the till was away.
 */
export function ClosedElsewhereNotice({
  storeId,
  shift,
}: {
  storeId: string | null;
  /** The open shift of the terminal: undefined while loading, null — none. */
  shift: Shift | null | undefined;
}) {
  const t = useTranslations('shift');
  const report = useClosedElsewhere(storeId, shift);
  if (!report?.forced) return null;
  return (
    <Alert tone="warning" live="polite">
      {t('closedElsewhere', {
        number: report.shift.number,
        name: report.forced.byName,
        time: report.shift.closedAt
          ? formatDateTime(report.shift.closedAt)
          : '—',
      })}
    </Alert>
  );
}
