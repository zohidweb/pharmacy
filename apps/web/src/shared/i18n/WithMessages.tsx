'use client';

import { Spinner } from '@pharmacy/ui';
import { useEffect, useState, type ReactNode } from 'react';
import {
  IntlProvider,
  useLocale,
  useMessages,
  useTranslations,
  type IntlError,
} from 'use-intl';
import {
  APP_TIME_ZONE,
  cachedGroups,
  loadGroups,
  type MessageGroup,
} from './config';

function reportError(error: IntlError) {
  // a missing key is a bug of the page's groups: loud in development and tests
  console.error(error);
}

/**
 * Adds the dictionary groups of a page to the core dictionary of the app provider. The groups load
 * as separate chunks; until then a spinner keeps the layout.
 */
export function WithMessages({
  groups,
  children,
}: {
  groups: readonly MessageGroup[];
  children: ReactNode;
}) {
  const locale = useLocale();
  const core = useMessages();
  const t = useTranslations('shell');
  const [loaded, setLoaded] = useState(() => ({
    key: `${locale}:${groups.join(',')}`,
    messages: cachedGroups(locale, groups),
  }));
  const key = `${locale}:${groups.join(',')}`;
  const current =
    loaded.key === key ? loaded.messages : cachedGroups(locale, groups);

  useEffect(() => {
    if (current) return;
    let cancelled = false;
    loadGroups(locale, groups).then((messages) => {
      if (!cancelled) setLoaded({ key, messages });
    });
    return () => {
      cancelled = true;
    };
    // groups are a constant of the page; the key covers them
  }, [key, current === null]);

  if (!current) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="lg" label={t('loading')} />
      </div>
    );
  }
  return (
    <IntlProvider
      locale={locale}
      messages={{ ...core, ...current }}
      timeZone={APP_TIME_ZONE}
      onError={reportError}
    >
      {children}
    </IntlProvider>
  );
}
