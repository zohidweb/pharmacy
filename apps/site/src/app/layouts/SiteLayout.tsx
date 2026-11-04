import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import type { ReactNode } from 'react';
import { APP_TIME_ZONE, getMessages, IntlClientProvider } from '@/shared/i18n';
import { SiteFooter } from '@/widgets/site-footer';
import { SiteHeader } from '@/widgets/site-header';
import '../styles/global.css';

export interface SiteLayoutProps {
  locale: UiLocale;
  /** `null` when the API is unavailable: header and footer still render, with the fallback name (W2). */
  info: PublicSiteInfo | null;
  children: ReactNode;
}

/*
 * Without JavaScript nothing reveals the elements that wait for the viewport (R2): they are shown as they are, and the
 * steps of «Как подключиться» take the colours of the reached ones (spec 2026-11-04-public-site-home-polish, H3; the
 * same rule is in site-theme.css under `(scripting: none)`, which older browsers do not know). A constant, never user
 * input.
 */
const NO_SCRIPT_REVEAL =
  '[data-reveal]{opacity:1!important;transform:none!important}' +
  '[data-step-marker]{border-color:var(--ph-site-accent);background-color:var(--ph-site-accent)}' +
  '[data-step-figure]{color:var(--ph-site-accent)}';

/**
 * The document of a language (W2): `<html lang>` in the site theme (a light page with colour panels, ADR-0024),
 * header, the page, footer.
 */
export function SiteLayout({ locale, info, children }: SiteLayoutProps) {
  const { errors, nav } = getMessages(locale);
  return (
    <html lang={locale} data-theme="site">
      <head>
        <noscript>
          <style>{NO_SCRIPT_REVEAL}</style>
        </noscript>
      </head>
      <body className="flex min-h-dvh flex-col bg-bg text-fg">
        <IntlClientProvider
          locale={locale}
          messages={{ errors, nav }}
          timeZone={APP_TIME_ZONE}
        >
          <SiteHeader locale={locale} info={info} />
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter locale={locale} info={info} />
        </IntlClientProvider>
      </body>
    </html>
  );
}
