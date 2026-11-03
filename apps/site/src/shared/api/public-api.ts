/*
 * Thin server-side client of the public API `/api/v1/public/*` (spec 5, 6.5): types from
 * @pharmacy/shared-dto, base address SITE_API_INTERNAL_URL. Every answer is cached by Next for 60 s
 * (ISR); `null` stands only for 404, anything else that is not 2xx throws SiteApiError.
 */
import type {
  LegalDocumentKind,
  LegalDocumentRevision,
  Page,
  PublicArticle,
  PublicArticleListItem,
  PublicSiteInfo,
  PublicSitemap,
  UiLocale,
} from '@pharmacy/shared-dto';
import { siteEnv } from '@/shared/config';

export const ARTICLES_PER_PAGE = 12;

/** The public API answered with an error, or did not answer at all (`status` 0). */
export class SiteApiError extends Error {
  constructor(
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(`Public API request failed: ${status || 'no answer'}`, options);
    this.name = 'SiteApiError';
  }
}

type Query = Record<string, string | number>;

async function request<T>(path: string, query: Query = {}): Promise<T | null> {
  const url = new URL(`/api/v1/public/${path}`, siteEnv().apiInternalUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new SiteApiError(0, { cause: error });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new SiteApiError(response.status);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new SiteApiError(0, { cause: error });
  }
}

async function required<T>(path: string, query?: Query): Promise<T> {
  const body = await request<T>(path, query);
  if (body === null) throw new SiteApiError(404);
  return body;
}

export function getSiteInfo(): Promise<PublicSiteInfo> {
  return required<PublicSiteInfo>('site-info');
}

/**
 * The settings for the parts that must never fail, the header, footer and metadata (W2): `null` when the API
 * is unavailable. The page body uses getSiteInfo, so the failure still reaches error.tsx.
 */
export function findSiteInfo(): Promise<PublicSiteInfo | null> {
  return getSiteInfo().catch(() => null);
}

/** `page` starts at 1. */
export function getArticles(
  locale: UiLocale,
  page: number,
): Promise<Page<PublicArticleListItem>> {
  // the page route validates it already (blog/model/page-number.ts); a bad one must never become a negative offset
  if (!Number.isInteger(page) || page < 1) {
    return Promise.reject(new RangeError(`Invalid blog page: ${page}`));
  }
  return required<Page<PublicArticleListItem>>('articles', {
    locale,
    limit: ARTICLES_PER_PAGE,
    offset: (page - 1) * ARTICLES_PER_PAGE,
  });
}

export function getArticle(
  slug: string,
  locale: UiLocale,
): Promise<PublicArticle | null> {
  return request<PublicArticle>(`articles/${encodeURIComponent(slug)}`, {
    locale,
  });
}

export function getLegalDocument(
  kind: LegalDocumentKind,
  locale: UiLocale,
): Promise<LegalDocumentRevision | null> {
  return request<LegalDocumentRevision>(`legal-documents/${kind}`, { locale });
}

export function getSitemap(): Promise<PublicSitemap> {
  return required<PublicSitemap>('sitemap');
}

/** Relative on purpose: the browser loads pictures through Caddy (in dev, the dev rewrite). */
export function mediaPath(id: string): string {
  return `/api/v1/public/media/${id}`;
}
