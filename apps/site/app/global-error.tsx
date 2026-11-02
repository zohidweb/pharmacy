'use client';

import type { UiLocale } from '@pharmacy/shared-dto';
import { buttonClassName } from '@pharmacy/ui';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createTranslator } from 'use-intl/core';
import type { Messages } from '@/shared/i18n';
import { loadMessages } from '@/shared/i18n/load-messages';
import { localePath } from '@/shared/lib';
import {
  pressClassName,
  stateScreenActionsClassName,
  stateScreenClassName,
  stateScreenCodeClassName,
  stateScreenTextClassName,
  stateScreenTitleClassName,
} from '@/shared/ui';
import '@/app/styles/global.css';

/**
 * The last line (W2): the layout of the language itself failed, so this renders its own document.
 * Next renders it in the browser; the dictionary loads as its own chunk, not with every page.
 * No motion here (ADR-0024): the way home is a plain link styled as the button, a full page load, which is also what
 * a broken layout needs.
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
    // and if both fail, a neutral status code instead of a blank screen
    loadMessages(locale)
      .then((messages) => ({ locale, messages }))
      .catch(() =>
        loadMessages(other).then((messages) => ({ locale: other, messages })),
      )
      .then(setLoaded, () => setFailed(true));
  }, [locale]);
  const t = loaded && createTranslator(loaded);
  return (
    <html lang={loaded?.locale ?? locale} data-theme="site">
      <body className="flex min-h-dvh flex-col bg-site-canvas text-fg">
        {failed && (
          <main className={stateScreenClassName}>
            <p className={stateScreenCodeClassName}>500</p>
          </main>
        )}
        {loaded && t && (
          <main className={stateScreenClassName}>
            <p aria-hidden="true" className={stateScreenCodeClassName}>
              500
            </p>
            <h1 className={stateScreenTitleClassName}>
              {t('errors.unavailable.title')}
            </h1>
            <p className={stateScreenTextClassName}>
              {t('errors.unavailable.description')}
            </p>
            <div className={stateScreenActionsClassName}>
              <a
                href={localePath(loaded.locale, '/')}
                className={buttonClassName({
                  size: 'lg',
                  className: pressClassName,
                })}
              >
                {t('nav.home')}
              </a>
            </div>
          </main>
        )}
      </body>
    </html>
  );
}
