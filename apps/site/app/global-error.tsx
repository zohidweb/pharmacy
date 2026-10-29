'use client';

import type { UiLocale } from '@pharmacy/shared-dto';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createTranslator } from 'use-intl/core';
import type { Messages } from '@/shared/i18n';
import { loadMessages } from '@/shared/i18n/load-messages';
import '@/app/styles/global.css';

/**
 * The last line (W2): the layout of the language itself failed, so this renders its own document.
 * Next renders it in the browser; the dictionary loads as its own chunk, not with every page.
 */
export default function GlobalError() {
  const locale: UiLocale =
    useParams<{ locale?: string }>()?.locale === 'tg' ? 'tg' : 'ru';
  const [loaded, setLoaded] = useState<{
    locale: UiLocale;
    messages: Messages;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const other: UiLocale = locale === 'tg' ? 'ru' : 'tg';
    // the chunk of the page's dictionary may fail too (the network is what broke): then the other one,
    // and if both fail — a neutral status code instead of a blank screen
    loadMessages(locale)
      .then((messages) => ({ locale, messages }))
      .catch(() =>
        loadMessages(other).then((messages) => ({ locale: other, messages })),
      )
      .then(setLoaded, () => setFailed(true));
  }, [locale]);
  const t = loaded && createTranslator(loaded);
  return (
    <html lang={loaded?.locale ?? locale}>
      <body>
        {failed && (
          <main className="mx-auto flex max-w-(--ph-size-dialog-md) flex-col items-center gap-4 px-6 py-16 text-center">
            <p className="text-4xl font-bold text-border-strong">500</p>
          </main>
        )}
        {t && (
          <main className="mx-auto flex max-w-(--ph-size-dialog-md) flex-col items-center gap-4 px-6 py-16 text-center">
            <h1 className="text-xl font-bold tracking-tight">
              {t('errors.unavailable.title')}
            </h1>
            <p className="text-sm text-fg-muted">
              {t('errors.unavailable.description')}
            </p>
          </main>
        )}
      </body>
    </html>
  );
}
