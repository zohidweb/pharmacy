import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { getTranslator } from '@/shared/i18n';
import { pageMetadata, siteNameOf } from '@/shared/seo';

/** «Заявка на подключение — <name>» (the layout's template), canonical and hreflang of `/connect`, Open Graph. */
export function connectMetadata(
  locale: UiLocale,
  info: PublicSiteInfo | null,
): Metadata {
  const t = getTranslator(locale);
  const title = t('connect.title');
  return pageMetadata({
    locale,
    path: '/connect',
    info,
    title,
    openGraphTitle: `${title} — ${siteNameOf(info, locale)}`,
    description: t('connect.description'),
  });
}
