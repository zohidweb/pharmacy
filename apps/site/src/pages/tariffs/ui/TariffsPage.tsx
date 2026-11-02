/*
 * Tariffs and services (spec 6.3, W6): the price of a store, «НДС N % сверху», the billing rule and the
 * one-time services. No calculator (W6). Figures come from the billing settings, so they match invoices.
 */
import { vatOf } from '@pharmacy/shared-domain';
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { formatMoney, formatPercentBp } from '@pharmacy/shared-util';
import { buttonClassName, Card } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath, pickText } from '@/shared/lib';

export interface TariffsPageProps {
  locale: UiLocale;
  info: PublicSiteInfo;
}

export function TariffsPage({ locale, info }: TariffsPageProps) {
  const t = getTranslator(locale);
  const { storeMonthlyPriceDirams: price, vatBp, services } = info.pricing;
  const vat = formatPercentBp(vatBp);
  return (
    <main className="@container mx-auto flex w-full max-w-(--ph-size-dialog-xl) flex-col gap-10 px-4 py-12">
      <header className="flex max-w-(--ph-size-dialog-lg) flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          {t('tariffs.title')}
        </h1>
        <p className="text-fg-muted">{t('tariffs.intro')}</p>
      </header>

      <section aria-labelledby="store-title">
        <Card className="flex flex-col gap-6 @2xl:flex-row @2xl:justify-between">
          <div className="flex flex-col gap-2">
            <h2 id="store-title" className="text-lg font-semibold">
              {t('tariffs.store.title')}
            </h2>
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">
                {formatMoney(price)}
              </span>
              <span className="text-fg-muted">
                {t('tariffs.store.perMonth')}
              </span>
            </p>
            <p className="text-sm font-medium">
              {t('tariffs.store.vat', { vat })}
            </p>
            <p className="text-sm text-fg-muted">
              {t('tariffs.store.withVat', {
                price: formatMoney(price + vatOf(price, vatBp)),
              })}
            </p>
          </div>
          <div className="flex max-w-(--ph-size-dialog-sm) flex-col gap-2">
            <h3 className="text-md font-semibold">
              {t('tariffs.store.billing')}
            </h3>
            <p className="text-sm text-fg-muted">
              {t('tariffs.store.billingDetails')}
            </p>
          </div>
        </Card>
      </section>

      {services.length > 0 && (
        <section
          aria-labelledby="services-title"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="services-title"
              className="text-xl font-bold tracking-tight"
            >
              {t('tariffs.services.title')}
            </h2>
            <p className="text-sm text-fg-muted">
              {t('tariffs.services.vatNote')}
            </p>
          </div>
          <ul className="grid gap-4 @xl:grid-cols-2">
            {services.map((service) => {
              const description = pickText(service.description, locale).trim();
              return (
                <li key={service.id} className="flex">
                  <Card className="flex flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-md font-semibold">
                        {pickText(service.name, locale)}
                      </h3>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(service.basePriceDirams)}
                      </span>
                    </div>
                    {description && (
                      <p className="text-sm text-fg-muted">{description}</p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-col items-start gap-4 border-t border-border pt-8">
        <p className="max-w-(--ph-size-dialog-lg)">{t('tariffs.cta')}</p>
        <Link
          href={localePath(locale, '/connect')}
          className={buttonClassName({ size: 'lg' })}
        >
          {t('nav.connect')}
        </Link>
      </div>
    </main>
  );
}
