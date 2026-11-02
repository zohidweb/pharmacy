import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { getTranslator } from '@/shared/i18n';
import { pageMetadata, siteNameOf } from '@/shared/seo';
import { blogPagePath } from './page-number';

/**
 * «Блог | <name>»; a further page has its own title and canonical and no hreflang of the other language:
 * the languages have their own articles, so page N of one is not page N of the other.
 */
export function blogMetadata(
  locale: UiLocale,
  page: number,
  info: PublicSiteInfo | null,
): Metadata {
  const t = getTranslator(locale);
  const title = page === 1 ? t('blog.title') : t('blog.pageTitle', { page });
  return pageMetadata({
    locale,
    path: blogPagePath(page),
    info,
    title,
    openGraphTitle: `${title} | ${siteNameOf(info, locale)}`,
    description: t('blog.description'),
    ...(page > 1 && { available: [locale] }),
  });
}
