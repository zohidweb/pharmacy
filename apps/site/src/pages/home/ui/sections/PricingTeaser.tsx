/*
 * Тарифы (spec 4.5, п. 7): the colour block across the page, one of the two (with the final call). The price of a store
 * per month comes from the billing settings (the same figure as in the invoices), large; under it «НДС N % сверху» and
 * the link to /tariffs. The figure rises in as the block enters. On the block text and links take the main text colour
 * only (fg): mint would fall below 4.5:1 there (site-theme.css).
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { formatMoney, formatPercentBp } from '@pharmacy/shared-util';
import { Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { Reveal } from '@/shared/ui/motion';

export function PricingTeaser({
  locale,
  pricing,
}: {
  locale: UiLocale;
  pricing: PublicSiteInfo['pricing'];
}) {
  const t = getTranslator(locale);
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      data-surface="green"
      className="scroll-mt-4 text-fg"
    >
      <div className="mx-auto grid w-full max-w-site-content gap-10 px-4 md:px-8 py-16 md:grid-cols-2 md:items-end md:gap-16">
        <h2 id="pricing-title" className="text-section text-balance">
          {t('home.pricing.title')}
        </h2>
        <div className="flex flex-col items-start gap-4">
          <Reveal>
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-display-sm whitespace-nowrap tabular-nums md:text-display">
                {formatMoney(pricing.storeMonthlyPriceDirams)}
              </span>
              <span className="text-lead">{t('home.pricing.perMonth')}</span>
            </p>
          </Reveal>
          <p className="max-w-(--ph-size-dialog-md) text-lead">
            {t('home.pricing.vat', { vat: formatPercentBp(pricing.vatBp) })}
          </p>
          <Link
            href={localePath(locale, '/tariffs')}
            className="inline-flex min-h-touch items-center gap-2 font-semibold text-fg underline underline-offset-4"
          >
            {t('home.pricing.more')}
            <Icon name="chevron-right" size="sm" />
          </Link>
        </div>
      </div>
    </section>
  );
}
