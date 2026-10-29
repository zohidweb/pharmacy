'use client';

import { buttonClassName } from '@pharmacy/ui';
import Link from 'next/link';
import { useLocale, useTranslations } from 'use-intl';
import { localePath } from '@/shared/lib';

/** 404 inside the layout of the language (W1): unknown addresses and missing content. */
export default function LocaleNotFound() {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <main className="mx-auto flex max-w-(--ph-size-dialog-md) flex-col items-center gap-4 px-6 py-16 text-center">
      <p aria-hidden="true" className="text-4xl font-bold text-border-strong">
        404
      </p>
      <h1 className="text-xl font-bold tracking-tight">
        {t('errors.notFound.title')}
      </h1>
      <p className="text-sm text-fg-muted">
        {t('errors.notFound.description')}
      </p>
      <Link href={localePath(locale, '/')} className={buttonClassName()}>
        {t('nav.home')}
      </Link>
    </main>
  );
}
