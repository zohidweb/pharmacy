import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { getTranslator } from '@/shared/i18n';
import { pageMetadata, siteNameOf } from '@/shared/seo';

/** «Тарифы и услуги | <name>» (the layout's template), canonical and hreflang of `/tariffs`, Open Graph. */
export function tariffsMetadata(
  locale: UiLocale,
  info: PublicSiteInfo | null,
): Metadata {
  const t = getTranslator(locale);
  const title = t('tariffs.title');
  return pageMetadata({
    locale,
    path: '/tariffs',
    info,
    title,
    openGraphTitle: `${title} | ${siteNameOf(info, locale)}`,
    description: t('tariffs.description'),
  });
}
