'use client';

import { Alert } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import type { StockAccess } from '../model/access';

/** «Только просмотр» and «закупочные цены скрыты» banners of the stock screens (UI mockups). */
export function StockNotices({ access }: { access: StockAccess }) {
  const t = useTranslations('stockDocs.notices');
  return (
    <>
      {access.readOnly && <Alert tone="info">{t(access.readOnly)}</Alert>}
      {!access.canSeeCost && <Alert tone="info">{t('costHidden')}</Alert>}
    </>
  );
}
