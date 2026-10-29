'use client';

import { buttonClassName } from '@pharmacy/ui';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import { useTranslations } from 'use-intl';

/**
 * A page failed, e.g. the API is unavailable on its first render (W2, Review Focus 1): the layout
 * stays, the body says so — no stack. A page already in the ISR cache keeps being served instead.
 */
export default function LocaleError({ reset }: { reset: () => void }) {
  const t = useTranslations('errors.unavailable');
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main className="mx-auto flex max-w-(--ph-size-dialog-md) flex-col items-center gap-4 px-6 py-16 text-center">
      <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-fg-muted">{t('description')}</p>
      <button type="button" onClick={retry} className={buttonClassName()}>
        {t('retry')}
      </button>
    </main>
  );
}
