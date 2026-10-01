'use client';

import type { ImpersonationInfo } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import { Alert } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

/** A platform operator works «от имени» владельца: view only, recorded in the audit (ADR-0008). */
export function ImpersonationBanner({ info }: { info: ImpersonationInfo }) {
  const t = useTranslations('shell.impersonation');
  return (
    <Alert tone="attention" title={t('title')} className="mx-6 mt-4">
      {t('text', {
        operator: info.operatorName,
        at: formatDateTime(info.startedAt),
      })}
    </Alert>
  );
}
