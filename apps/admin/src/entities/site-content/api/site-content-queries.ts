import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  apiRequest,
  type ArticleListQuery,
  type SiteMediaListQuery,
} from '@/shared/api';

export const siteKeys = {
  articles: (query: ArticleListQuery) => ['site', 'articles', query] as const,
  article: (id: string) => ['site', 'article', id] as const,
  legal: ['site', 'legal'] as const,
  /** Every page of the library: for invalidation after an upload. */
  mediaAll: ['site', 'media'] as const,
  media: (query: SiteMediaListQuery) => ['site', 'media', query] as const,
  settings: ['site', 'settings'] as const,
};

/** The picture file itself: the public contour is closed on the admin's domain (spec 2026-10-28-public-site-design, 6.3). */
export const siteMediaContentUrl = (id: string): string =>
  `/api/v1/operator/site-media/${encodeURIComponent(id)}/content`;

export function useArticleList(query: ArticleListQuery) {
  return useQuery({
    queryKey: siteKeys.articles(query),
    queryFn: ({ signal }) => apiRequest('articles.list', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useArticle(id: string) {
  return useQuery({
    queryKey: siteKeys.article(id),
    queryFn: ({ signal }) =>
      apiRequest('articles.get', { params: { id }, signal }),
    enabled: id !== '',
  });
}

export function useLegalDocuments() {
  return useQuery({
    queryKey: siteKeys.legal,
    queryFn: ({ signal }) => apiRequest('legalDocuments.overview', { signal }),
  });
}

export function useSiteMediaList(query: SiteMediaListQuery) {
  return useQuery({
    queryKey: siteKeys.media(query),
    queryFn: ({ signal }) => apiRequest('siteMedia.list', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useSiteSettings() {
  return useQuery({
    queryKey: siteKeys.settings,
    queryFn: ({ signal }) => apiRequest('siteSettings.get', { signal }),
  });
}
