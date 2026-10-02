/*
 * Test wrapper with the client product's providers: fresh QueryClient per test (no retries),
 * RU core messages (pages bring their groups via WithMessages), Dushanbe time zone and toasts.
 */
import { ToastProvider } from '@pharmacy/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import {
  APP_TIME_ZONE,
  defaultMessages,
  seedMessageGroup,
} from '@/shared/i18n';
import home from '@/shared/i18n/messages/ru/home.json';
import ownerGroup from '@/shared/i18n/messages/ru/owner.json';
import pos from '@/shared/i18n/messages/ru/pos.json';
import purchasing from '@/shared/i18n/messages/ru/purchasing.json';
import stock from '@/shared/i18n/messages/ru/stock.json';

// pages add their groups to the core dictionary; the cache spares the async chunks in tests
seedMessageGroup('ru', 'pos', pos);
seedMessageGroup('ru', 'home', home);
seedMessageGroup('ru', 'stock', stock);
seedMessageGroup('ru', 'purchasing', purchasing);
seedMessageGroup('ru', 'owner', ownerGroup);

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
