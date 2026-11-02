'use client';

import { buttonClassName } from '@pharmacy/ui';
import Link from 'next/link';
import { useLocale, useTranslations } from 'use-intl';
import { localePath } from '@/shared/lib';
import {
  pressClassName,
  stateScreenActionsClassName,
  stateScreenClassName,
  stateScreenCodeClassName,
  stateScreenTextClassName,
  stateScreenTitleClassName,
} from '@/shared/ui';

/** 404 inside the layout of the language (W1): unknown addresses and missing content. No motion: CSS press only. */
export default function LocaleNotFound() {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <main className={stateScreenClassName}>
      <p aria-hidden="true" className={stateScreenCodeClassName}>
        404
      </p>
      <h1 className={stateScreenTitleClassName}>
        {t('errors.notFound.title')}
      </h1>
      <p className={stateScreenTextClassName}>
        {t('errors.notFound.description')}
      </p>
      <div className={stateScreenActionsClassName}>
        <Link
          href={localePath(locale, '/')}
          className={buttonClassName({ size: 'lg', className: pressClassName })}
        >
          {t('nav.home')}
        </Link>
      </div>
    </main>
  );
}
