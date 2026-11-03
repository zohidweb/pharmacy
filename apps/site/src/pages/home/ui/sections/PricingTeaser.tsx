/*
 * Тарифы (amendment 2026-11-02-public-site-light-panels 4.4, п. 7; L9): a green panel, the heading on the left. On the
 * right the price of a store per month from the billing settings (the same figure as in the invoices), huge, under it
 * «НДС N % сверху» and the link to /tariffs. No list of what the price includes: the dictionary has no short lines for
 * it. The figure rises in as the panel enters. On the panel text and links take the panel's own text colour (fg).
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { formatMoney, formatPercentBp } from '@pharmacy/shared-util';
import { cx, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import {
  contentClassName,
  panelBodyClassName,
  panelClassName,
} from '@/shared/ui';
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
      className={cx(panelClassName, 'scroll-mt-4')}
    >
      <div
        className={cx(
          contentClassName,
          panelBodyClassName,
          'grid gap-10 md:grid-cols-2 md:items-end md:gap-16',
        )}
      >
        <h2 id="pricing-title" className="text-section text-balance">
          {t('home.pricing.title')}
        </h2>
        <div className="flex flex-col items-start gap-4">
          <Reveal>
            <p className="flex flex-col gap-2">
              <span className="text-site-figure-sm whitespace-nowrap tabular-nums md:text-site-figure">
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
