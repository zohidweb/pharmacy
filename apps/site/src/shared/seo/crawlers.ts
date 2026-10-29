/*
 * robots.txt and sitemap.xml (spec 6.1, 9). Both are read at request time (`force-dynamic` in their route
 * files): the indexing switch and the origin come from the environment, the build never asks the API.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import type { MetadataRoute } from 'next';
import { getSitemap } from '@/shared/api';
import { absoluteUrl, siteEnv } from '@/shared/config';
import { locales } from '@/shared/i18n';
import { localePath } from '@/shared/lib';

/** Prod indexes everything but the API; any other stand (`SITE_INDEXING` unset) is closed to crawlers. */
export function siteRobots(): MetadataRoute.Robots {
  if (!siteEnv().indexing) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}

/** The pages that exist in both languages and do not come from the API. */
const STATIC_PATHS = ['/', '/tariffs', '/blog', '/connect'] as const;

/** One entry per language of a page, each with the hreflang of all the page's languages. */
function entries(
  path: string,
  available: readonly UiLocale[],
  lastModified?: string,
): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    available.map((locale) => [locale, absoluteUrl(localePath(locale, path))]),
  );
  return available.map((locale) => ({
    url: absoluteUrl(localePath(locale, path)),
    ...(lastModified && { lastModified }),
    alternates: { languages },
  }));
}

/**
 * The static pages in both languages, the articles and the legal documents in the languages they exist in
 * (Review Focus 2). An API failure throws (500): a crawler retries an error, but would take a partial
 * sitemap for the truth.
 */
export async function siteSitemap(): Promise<MetadataRoute.Sitemap> {
  const { articles, legal } = await getSitemap();
  return [
    ...STATIC_PATHS.flatMap((path) => entries(path, locales)),
    ...articles.flatMap((article) =>
      entries(`/blog/${article.slug}`, article.locales, article.updatedAt),
    ),
    ...legal.flatMap((document) =>
      entries(`/${document.kind}`, document.locales, document.updatedAt),
    ),
  ];
}
