import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { getTranslator } from '@/shared/i18n';
import { pageMetadata, siteNameOf } from '@/shared/seo';
import { loadArticle } from './load-article';

/**
 * The SEO title and description of the article (its title and excerpt when empty), hreflang only of the
 * languages it exists in (Review Focus 2), Open Graph `article` with the cover. A missing article: no
 * metadata: the page answers 404.
 */
export async function articleMetadata(
  locale: UiLocale,
  slug: string,
  info: PublicSiteInfo | null,
): Promise<Metadata> {
  const article = await loadArticle(slug, locale);
  if (!article) return {};
  const title = article.seoTitle.trim() || article.title;
  const description =
    article.seoDescription.trim() ||
    article.excerpt.trim() ||
    getTranslator(locale)('blog.description');
  return pageMetadata({
    locale,
    path: `/blog/${article.slug}`,
    info,
    title,
    openGraphTitle: `${title} | ${siteNameOf(info, locale)}`,
    description,
    available: article.locales,
    imageId: article.coverMediaId,
    article: {
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
    },
  });
}
