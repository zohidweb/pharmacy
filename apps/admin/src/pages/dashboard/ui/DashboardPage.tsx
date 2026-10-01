'use client';

import { EmptyState } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { PageHeader } from '@/widgets/app-shell';

/** Dashboard frame; KPIs, the operator queue and charts arrive with the companies and billing screens. */
export function DashboardPage() {
  const t = useTranslations('dashboard');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="p-6">
        <EmptyState
          icon="layout-dashboard"
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      </div>
    </>
  );
}
