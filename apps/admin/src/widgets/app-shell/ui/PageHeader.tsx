'use client';

import { SegmentedControl } from '@pharmacy/ui';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import type { ApiRouteKey } from '@/shared/api';
import { locales, setLocale, useLocale } from '@/shared/i18n';
import { DemoDataNotice } from '@/shared/ui';
import { NotificationsBell } from './NotificationsBell';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Page-level actions placed before the global controls. */
  actions?: ReactNode;
  /** The routes of a screen not on apps/api yet: «Демо-данные» under the header (`partial` mode). */
  demoRoutes?: readonly ApiRouteKey[];
}

/** Sticky header of every admin screen: page title, page actions, language and notifications. */
export function PageHeader({
  title,
  subtitle,
  actions,
  demoRoutes,
}: PageHeaderProps) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <>
      <header className="sticky top-0 z-(--ph-z-sticky) flex flex-wrap items-center gap-4 border-b border-border bg-surface px-6 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-xl font-bold tracking-tight text-fg">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-fg-subtle">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
        <SegmentedControl
          label={t('shell.localeLabel')}
          value={locale}
          onValueChange={setLocale}
          options={locales.map((value) => ({
            value,
            label: value === 'tg' ? 'TJ' : 'RU',
            ariaLabel: t(`locales.${value}`),
          }))}
        />
        <NotificationsBell />
      </header>
      {demoRoutes && (
        <DemoDataNotice routes={demoRoutes} className="mx-6 mt-6" />
      )}
    </>
  );
}
