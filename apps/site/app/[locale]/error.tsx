'use client';

import { buttonClassName } from '@pharmacy/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
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

/**
 * A page failed, e.g. the API is unavailable on its first render (W2, Review Focus 1): the layout
 * stays, the body says so, with no stack. A page already in the ISR cache keeps being served instead.
 */
export default function LocaleError({ reset }: { reset: () => void }) {
  const t = useTranslations('errors.unavailable');
  const nav = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main className={stateScreenClassName}>
      <p aria-hidden="true" className={stateScreenCodeClassName}>
        500
      </p>
      <h1 className={stateScreenTitleClassName}>{t('title')}</h1>
      <p className={stateScreenTextClassName}>{t('description')}</p>
      <div className={stateScreenActionsClassName}>
        <button
          type="button"
          onClick={retry}
          className={buttonClassName({ size: 'lg', className: pressClassName })}
        >
          {t('retry')}
        </button>
        <Link
          href={localePath(locale, '/')}
          className={buttonClassName({
            variant: 'secondary',
            size: 'lg',
            className: pressClassName,
          })}
        >
          {nav('home')}
        </Link>
      </div>
    </main>
  );
}
