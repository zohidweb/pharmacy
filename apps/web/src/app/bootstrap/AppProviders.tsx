'use client';

/*
 * Client providers of the client product: server-data cache (TanStack Query) following our own
 * connection detector, i18n (use-intl), toasts and the Service Worker of the cloud build.
 * In development with NEXT_PUBLIC_API_MOCKS=true the in-memory API mocks are installed before any
 * query runs; the mock code is loaded only then and never reaches a build without the flag.
 */
import { ToastProvider } from '@pharmacy/ui';
import {
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { resetSession, retrySignOutOnReconnect } from '@/entities/session';
import { ConfirmPasswordDialog } from '@/features/confirm-password';
import {
  apiMocksEnabled,
  apiMocksMode,
  apiRequest,
  isOnline,
  isSessionEnded,
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
import { navCountersKey } from '@/widgets/app-shell';
import { ServiceWorker } from './ServiceWorker';

function createQueryClient() {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // no retries of an answer that the session is gone: the sign-in opens at once
        retry: (failures, error) => !isSessionEnded(error) && failures < 3,
      },
    },
    // a session the server ended (timeout, blocked, ended elsewhere) returns to the sign-in at the first answer that
    // says so, whatever screen asked (security review 2026-10-22, F2)
    queryCache: new QueryCache({
      onError: (error) => {
        if (isSessionEnded(error)) resetSession(client);
      },
    }),
    // the menu counters follow the employee's own changes at once — an accepted transfer, a price,
    // a posted document (spec 2026-10-15-nav-counters, E9); others' changes — within a minute
    mutationCache: new MutationCache({
      onSuccess: () =>
        void client.invalidateQueries({ queryKey: navCountersKey }),
      onError: (error) => {
        if (isSessionEnded(error)) resetSession(client);
      },
    }),
  });
  return client;
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
  useEffect(() => retrySignOutOnReconnect(queryClient), [queryClient]);

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
              <ConfirmPasswordDialog />
            </>
          ) : null}
        </ToastProvider>
      </IntlProvider>
    </QueryClientProvider>
  );
}
