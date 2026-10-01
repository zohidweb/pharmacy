'use client';

/*
 * Client providers of the admin: server-data cache (TanStack Query), i18n (use-intl) and toasts.
 * In development with NEXT_PUBLIC_API_MOCKS=true the in-memory API mocks are installed before any
 * query runs; the mock code is loaded only then and never reaches a build without the flag.
 */
import { ToastProvider } from '@pharmacy/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import {
  apiMocksEnabled,
  loadMockTransport,
  setApiTransport,
} from '@/shared/api';
import {
  APP_TIME_ZONE,
  defaultLocale,
  defaultMessages,
  loadMessages,
  useLocale,
  type Locale,
  type Messages,
} from '@/shared/i18n';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
}

function useMessages(locale: Locale) {
  const [loaded, setLoaded] = useState<{ locale: Locale; messages: Messages }>({
    locale: defaultLocale,
    messages: defaultMessages,
  });

  useEffect(() => {
    let cancelled = false;
    loadMessages(locale).then((messages) => {
      if (cancelled) return;
      setLoaded({ locale, messages });
      document.documentElement.lang = locale;
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return loaded;
}

function useApiReady() {
  const [ready, setReady] = useState(!apiMocksEnabled);
  useEffect(() => {
    if (!apiMocksEnabled) return;
    loadMockTransport().then((mockTransport) => {
      setApiTransport(mockTransport);
      setReady(true);
    });
  }, []);
  return ready;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const { locale, messages } = useMessages(useLocale());
  const apiReady = useApiReady();

  return (
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={messages}
        timeZone={APP_TIME_ZONE}
      >
        <ToastProvider>{apiReady ? children : null}</ToastProvider>
      </IntlProvider>
    </QueryClientProvider>
  );
}
