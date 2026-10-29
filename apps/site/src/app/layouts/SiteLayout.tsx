import type { UiLocale } from '@pharmacy/shared-dto';
import type { ReactNode } from 'react';
import {
  APP_TIME_ZONE,
  getMessages,
  IntlClientProvider,
} from '@/shared/i18n';
import '../styles/global.css';

export interface SiteLayoutProps {
  locale: UiLocale;
  children: ReactNode;
}

/** The document of a language (W2): `<html lang>`; header and footer come with the pages (Task 3). */
export function SiteLayout({ locale, children }: SiteLayoutProps) {
  const { errors, nav } = getMessages(locale);
  return (
    <html lang={locale}>
      <body>
        <IntlClientProvider
          locale={locale}
          messages={{ errors, nav }}
          timeZone={APP_TIME_ZONE}
        >
          {children}
        </IntlClientProvider>
      </body>
    </html>
  );
}
