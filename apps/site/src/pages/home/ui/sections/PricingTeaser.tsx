import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { formatMoney, formatPercentBp } from '@pharmacy/shared-util';
import { buttonClassName, Card } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { PageSection } from '@/shared/ui';

/** spec 6.2, п. 6: the price of a store from the billing settings — the same figure as in the invoices. */
export function PricingTeaser({
  locale,
  pricing,
}: {
  locale: UiLocale;
  pricing: PublicSiteInfo['pricing'];
}) {
  const t = getTranslator(locale);
  return (
    <PageSection id="pricing" tone="surface" title={t('home.pricing.title')}>
      <Card className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {formatMoney(pricing.storeMonthlyPriceDirams)}
            </span>
            <span className="text-fg-muted">{t('home.pricing.perMonth')}</span>
          </p>
          <p className="text-sm text-fg-muted">
            {t('home.pricing.vat', { vat: formatPercentBp(pricing.vatBp) })}
          </p>
        </div>
        <Link
          href={localePath(locale, '/tariffs')}
          className={buttonClassName({ variant: 'secondary' })}
        >
          {t('home.pricing.more')}
        </Link>
      </Card>
    </PageSection>
  );
}
