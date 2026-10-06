'use client';

/*
 * Client providers of the client product: server-data cache (TanStack Query) following our own
 * connection detector, i18n (use-intl), toasts and the Service Worker of the cloud build.
 * In development with NEXT_PUBLIC_API_MOCKS=true the in-memory API mocks are installed before any
 * query runs; the mock code is loaded only then and never reaches a build without the flag.
 */
import { ToastProvider } from '@pharmacy/ui';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import {
  apiMocksEnabled,
  apiMocksMode,
  apiRequest,
  isOnline,
  loadMockTransport,
  partialTransport,
  setApiTransport,
  startConnectivity,
  subscribeConnectivity,
} from '@/shared/api';
import {
  APP_TIME_ZONE,
  defaultLocale,
  defaultMessages,
  loadMessages,
  useLocale,
  type Locale,
  type CoreMessages,
} from '@/shared/i18n';
import { ServiceWorker } from './ServiceWorker';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
}

function useMessages(locale: Locale) {
  const [loaded, setLoaded] = useState<{
    locale: Locale;
    messages: CoreMessages;
  }>({
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

/** TanStack Query follows our own connection detector, not navigator.onLine (ADR-0015, 2а). */
function useConnectivity(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    onlineManager.setEventListener((setOnline) => {
      setOnline(isOnline());
      return subscribeConnectivity(setOnline);
    });
    return startConnectivity(() => apiRequest('health.get'));
  }, [ready]);
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const { locale, messages } = useMessages(useLocale());
  const apiReady = useApiReady();
  useConnectivity(apiReady);

  return (
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={messages}
        timeZone={APP_TIME_ZONE}
      >
        <ToastProvider>
          {apiReady ? (
            <>
              <ServiceWorker />
              {children}
            </>
          ) : null}
        </ToastProvider>
      </IntlProvider>
    </QueryClientProvider>
  );
}
