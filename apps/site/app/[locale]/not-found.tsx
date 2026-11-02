'use client';

import { useLocale, useTranslations } from 'use-intl';
import { localePath } from '@/shared/lib';
import {
  stateScreenActionsClassName,
  stateScreenClassName,
  stateScreenCodeClassName,
  stateScreenTextClassName,
  stateScreenTitleClassName,
} from '@/shared/ui';
import { PressableLink } from '@/shared/ui/motion';

/** 404 inside the layout of the language (W1): unknown addresses and missing content. */
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
        <PressableLink href={localePath(locale, '/')} variant="primary" size="lg">
          {t('nav.home')}
        </PressableLink>
      </div>
    </main>
  );
}
