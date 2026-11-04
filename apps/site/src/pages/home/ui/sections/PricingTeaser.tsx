/*
 * Тарифы (amendment 2026-11-02-public-site-light-panels 4.4, п. 7; L9): a green panel, the heading on the left. On the
 * right the price of a store per month from the billing settings (the same figure as in the invoices), huge, under it
 * «НДС N % сверху», the stores calculator and the link to /tariffs. No list of what the price includes: the dictionary
 * has no short lines for it. The figure rises in as the panel enters. On the panel text and links take the panel's own
 * text colour (fg).
 *
 * Spec 2026-11-04-public-site-home-polish, H4: the price drops its zero dirams («400 с»; «412,50 с» stays), and the
 * calculator (a client leaf) gets its sentences from here, one pair per count of stores, already translated: the ICU
 * plural of the language is resolved on the server, so the client bundle carries no dictionary and no message parser.
 * A zero price shows no calculator.
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { formatMoney, formatPercentBp } from '@pharmacy/shared-util';
import { cx, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import {
  contentClassName,
  figureClassName,
  panelBodyClassName,
  panelClassName,
} from '@/shared/ui';
import { Reveal } from '@/shared/ui/motion';
import { CALCULATOR_STORES, storesTotal } from '../../model/stores-total';
import { PricingCalculator } from './PricingCalculator';

export function PricingTeaser({
  locale,
  pricing,
}: {
  locale: UiLocale;
  pricing: PublicSiteInfo['pricing'];
}) {
  const t = getTranslator(locale);
  const { storeMonthlyPriceDirams: storePrice, vatBp } = pricing;
  const price = formatMoney(storePrice, { trimZeroDirams: true });
  const money = (dirams: number) =>
    formatMoney(dirams, { trimZeroDirams: true });
  // a zero price has nothing to calculate: the slider would only move «0 с», so there is no calculator then (H4)
  const lines =
    storePrice > 0
      ? Array.from(
          { length: CALCULATOR_STORES.max - CALCULATOR_STORES.min + 1 },
          (_, index) => {
            const stores = CALCULATOR_STORES.min + index;
            const { totalDirams, withVatDirams } = storesTotal(
              storePrice,
              stores,
              vatBp,
            );
            return {
              total: t('home.pricing.calculator.total', {
                amount: money(totalDirams),
                stores,
              }),
              withVat: t('home.pricing.calculator.withVat', {
                amount: money(withVatDirams),
              }),
            };
          },
        )
      : null;
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
              {/* the figure never wraps (no-break spaces): its size follows its length (figureClassName) */}
              <span className={cx(figureClassName(price), 'tabular-nums')}>
                {price}
              </span>
              <span className="text-lead">{t('home.pricing.perMonth')}</span>
            </p>
          </Reveal>
          <p className="max-w-(--ph-size-dialog-md) text-lead">
            {t('home.pricing.vat', { vat: formatPercentBp(vatBp) })}
          </p>
          {lines && (
            <PricingCalculator
              {...CALCULATOR_STORES}
              labels={{
                label: t('home.pricing.calculator.label'),
                note: t('home.pricing.calculator.note'),
              }}
              lines={lines}
            />
          )}
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
