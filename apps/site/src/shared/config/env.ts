/*
 * Environment of the site (spec 5, ADR-0023): read on the server at call time, never inlined into the
 * client bundle. The site has no database, Redis or secrets: only these four variables.
 */
export interface SiteEnv {
  /** Base address of apps/api for server requests (`http://api:3000` in compose). */
  apiInternalUrl: string;
  /** Public address of the site: canonical, hreflang, sitemap, metadataBase. */
  siteOrigin: string;
  /** Address of apps/web: the «Войти» link. */
  webOrigin: string;
  /** Search engines may index the site (prod only). */
  indexing: boolean;
}

function origin(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, '');
}

export function siteEnv(): SiteEnv {
  return {
    apiInternalUrl: origin(
      process.env.SITE_API_INTERNAL_URL,
      'http://127.0.0.1:3000',
    ),
    siteOrigin: origin(process.env.SITE_ORIGIN, 'http://127.0.0.1:4400'),
    webOrigin: origin(process.env.WEB_ORIGIN, 'http://localhost:4200'),
    indexing: process.env.SITE_INDEXING === 'true',
  };
}
