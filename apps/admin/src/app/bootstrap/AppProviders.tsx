'use client';

/*
 * Client providers of the admin: server-data cache (TanStack Query), i18n (use-intl) and toasts.
 * In development with NEXT_PUBLIC_API_MOCKS=true (or `partial`: apps/api for the routes it serves)
 * the in-memory API mocks are installed before any query runs; the mock code is loaded only then and never reaches a build without the flag.
 */
import { ToastProvider } from '@pharmacy/ui';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { resetSession } from '@/entities/session';
import {
  apiMocksEnabled,
  apiMocksMode,
  isSessionEnded,
  loadMockTransport,
  partialTransport,
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
  // a session the server ended returns to the sign-in at the first answer that says so (security review 2026-10-22,
  // F2)
  const ended = (error: unknown) => {
    if (isSessionEnded(error)) resetSession(client);
  };
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // no retries of an answer that the session is gone: the sign-in opens at once
        retry: (failures, error) => !isSessionEnded(error) && failures < 3,
      },
    },
    queryCache: new QueryCache({ onError: ended }),
    mutationCache: new MutationCache({ onError: ended }),
  });
  return client;
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
      setApiTransport(
        apiMocksMode === 'partial'
          ? partialTransport(mockTransport)
          : mockTransport,
      );
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
