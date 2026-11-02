/*
 * Tariffs and services (spec 6.3, W6; redesign 4.6): the price of a store large, «НДС N % сверху» and the price with
 * VAT, the billing rule beside it, the one-time services as tiles (not a table) and the call to request. No calculator
 * (W6). Figures come from the billing settings, so they match invoices. No `motion` on this page: the heading rises in
 * by CSS, the request link gives on press (pressClassName).
 */
import { vatOf } from '@pharmacy/shared-domain';
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { formatMoney, formatPercentBp } from '@pharmacy/shared-util';
import { buttonClassName, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath, pickText } from '@/shared/lib';
import {
  pageClassName,
  pageHeaderClassName,
  pageLeadClassName,
  pageTitleClassName,
  pressClassName,
} from '@/shared/ui';

export interface TariffsPageProps {
  locale: UiLocale;
  info: PublicSiteInfo;
}

const tileClass = 'rounded-site-card border border-site-line bg-surface';

export function TariffsPage({ locale, info }: TariffsPageProps) {
  const t = getTranslator(locale);
  const { storeMonthlyPriceDirams: price, vatBp, services } = info.pricing;
  const vat = formatPercentBp(vatBp);
  return (
    <main className={pageClassName}>
      <header className={pageHeaderClassName}>
        <h1 className={pageTitleClassName}>{t('tariffs.title')}</h1>
        <p className={pageLeadClassName}>{t('tariffs.intro')}</p>
      </header>

      <section
        aria-labelledby="store-title"
        className="grid gap-4 md:grid-cols-site-main"
      >
        {/* the price: the wide tile, first in the reading order; the billing rule beside it */}
        <div className={`${tileClass} flex flex-col gap-6 p-6 md:p-10`}>
          <h2 id="store-title" className="text-2xl font-bold tracking-tight">
            {t('tariffs.store.title')}
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-display-sm whitespace-nowrap tabular-nums md:text-display">
              {formatMoney(price)}
            </span>
            <span className="text-lead text-fg-muted">
              {t('tariffs.store.perMonth')}
            </span>
          </p>
          <div className="flex flex-col gap-1 border-t border-site-line pt-6">
            <p className="text-lead font-semibold text-accent-site">
              {t('tariffs.store.vat', { vat })}
            </p>
            <p className="text-lead text-fg-muted">
              {t('tariffs.store.withVat', {
                price: formatMoney(price + vatOf(price, vatBp)),
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-site-card bg-surface-highlight p-6 md:p-10">
          <span className="text-accent-site">
            <Icon name="calendar-check" size="xl" />
          </span>
          <h3 className="mt-auto text-2xl font-bold tracking-tight text-balance">
            {t('tariffs.store.billing')}
          </h3>
          <p className="text-lead text-fg-muted">
            {t('tariffs.store.billingDetails')}
          </p>
        </div>
      </section>

      {services.length > 0 && (
        <section
          aria-labelledby="services-title"
          className="flex flex-col gap-8"
        >
          <div className="flex flex-col gap-4">
            <h2 id="services-title" className="text-section text-balance">
              {t('tariffs.services.title')}
            </h2>
            <p className="text-lead text-fg-muted">
              {t('tariffs.services.vatNote')}
            </p>
          </div>
          <ul className="grid gap-4 md:grid-cols-3">
            {services.map((service) => {
              const description = pickText(service.description, locale).trim();
              return (
                <li
                  key={service.id}
                  className={`${tileClass} flex flex-col gap-6 p-6 md:p-8`}
                >
                  <h3 className="text-2xl font-bold tracking-tight text-balance">
                    {pickText(service.name, locale)}
                  </h3>
                  {description && (
                    <p className="text-lead text-fg-muted">{description}</p>
                  )}
                  <p className="mt-auto text-3xl font-bold tabular-nums">
                    {formatMoney(service.basePriceDirams)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* the call to request: a sentence, not a section heading (headings stay within 8 words) */}
      <div className="flex flex-col items-start gap-6 rounded-site-card bg-surface-highlight p-6 md:flex-row md:items-center md:justify-between md:gap-16 md:p-10">
        <p className="max-w-(--ph-size-dialog-md) text-2xl font-bold tracking-tight text-balance">
          {t('tariffs.cta')}
        </p>
        <Link
          href={localePath(locale, '/connect')}
          className={buttonClassName({
            size: 'lg',
            className: `shrink-0 ${pressClassName}`,
          })}
        >
          {t('nav.connect')}
        </Link>
      </div>
    </main>
  );
}
