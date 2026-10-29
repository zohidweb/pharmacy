import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { getTranslator } from '@/shared/i18n';
import { pickText } from '@/shared/lib';
import { pageMetadata, siteNameOf } from '@/shared/seo';

/**
 * Title «<name> — <tagline>» without the layout's template, description — the SEO description of the
 * settings (an i18n text while it is empty), canonical and hreflang of `/` and `/tg`, Open Graph.
 */
export function homeMetadata(
  locale: UiLocale,
  info: PublicSiteInfo | null,
): Metadata {
  const name = siteNameOf(info, locale);
  const tagline = info ? pickText(info.settings.tagline, locale).trim() : '';
  const seoDescription = info
    ? pickText(info.settings.seoDescription, locale).trim()
    : '';
  const title = tagline ? `${name} — ${tagline}` : name;
  return pageMetadata({
    locale,
    path: '/',
    info,
    title: { absolute: title },
    openGraphTitle: title,
    description:
      seoDescription || getTranslator(locale)('home.meta.description'),
  });
}
