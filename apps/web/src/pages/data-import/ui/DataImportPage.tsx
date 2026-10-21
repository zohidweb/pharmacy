'use client';

import { Alert } from '@pharmacy/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useTranslations } from 'use-intl';
import { can, useSession } from '@/entities/session';
import { DataImportWizard, isImportKind } from '@/features/data-import';
import { useStockAccess } from '@/features/stock-document';
import { WithMessages } from '@/shared/i18n';
import { PageHeader } from '@/widgets/app-shell';

/**
 * «Загрузка из файла» (spec 2026-10-20-data-import, F20): `?kind=catalog|opening-balances|suppliers`. Opened from the
 * catalog, the opening balances and the suppliers; the API checks the permissions again (F14).
 */
function DataImportView() {
  const t = useTranslations('dataImport');
  const kind = useSearchParams()?.get('kind') ?? '';
  const { data: session } = useSession();
  const access = useStockAccess();
  if (!isImportKind(kind)) {
    return (
      <>
        <PageHeader title={t('pageTitle')} />
        <div className="px-6 pt-4">
          <Alert tone="warning">{t('notFound')}</Alert>
        </div>
      </>
    );
  }
  const allowed =
    kind === 'catalog'
      ? can(session, 'catalog:create')
      : kind === 'opening-balances'
        ? access.canCreate && access.canSeeCost
        : can(session, 'purchasing:create');
  return (
    <>
      <PageHeader title={t(`kinds.${kind}.title`)} />
      <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
        {allowed ? (
          <DataImportWizard
            key={kind}
            kind={kind}
            stores={access.writableStores}
            canCreateCategories={can(session, 'catalog:update')}
          />
        ) : (
          <Alert tone="warning">{t('noAccess')}</Alert>
        )}
      </div>
    </>
  );
}

export function DataImportPage() {
  return (
    <WithMessages groups={['stock']}>
      <Suspense>
        <DataImportView />
      </Suspense>
    </WithMessages>
  );
}
