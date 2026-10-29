import type { PublicArticle, UiLocale } from '@pharmacy/shared-dto';
import { getArticle } from '@/shared/api';

/** The slug rule of the API (`SaveArticleDto`): any other address is not an article, without asking. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The published article in the language, `null` for a 404: unknown slug, not published, or no text in this
 * language (Review Focus 2). The metadata and the page ask the same address: Next serves the second from cache.
 */
export function loadArticle(
  slug: string,
  locale: UiLocale,
): Promise<PublicArticle | null> {
  if (slug.length > 120 || !SLUG.test(slug)) return Promise.resolve(null);
  return getArticle(slug, locale);
}
