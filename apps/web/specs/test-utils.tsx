/*
 * Test wrapper with the client product's providers: fresh QueryClient per test (no retries),
 * RU messages, Dushanbe time zone and toasts.
 */
import { ToastProvider } from '@pharmacy/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { APP_TIME_ZONE, defaultMessages } from '@/shared/i18n';

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale="ru"
          messages={defaultMessages}
          timeZone={APP_TIME_ZONE}
        >
          <ToastProvider>{children}</ToastProvider>
        </IntlProvider>
      </QueryClientProvider>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
