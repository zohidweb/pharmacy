'use client';

import { Alert } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { type ApiRouteKey, servedByMocks } from '@/shared/api';

export interface DemoDataNoticeProps {
  /** The routes the screen or section reads. */
  routes: readonly ApiRouteKey[];
  /** Layout only. */
  className?: string;
}

/**
 * «Демо-данные» over a screen or section whose data still comes from the mocks while the rest of
 * the app runs against apps/api (the `partial` mode): its figures are an example, not real data.
 * Renders nothing in the other modes and once the routes reach apps/api.
 */
export function DemoDataNotice({ routes, className }: DemoDataNoticeProps) {
  const t = useTranslations('shell.demoData');
  if (!servedByMocks(...routes)) return null;
  return (
    <Alert tone="warning" title={t('title')} className={className}>
      {t('description')}
    </Alert>
  );
}
