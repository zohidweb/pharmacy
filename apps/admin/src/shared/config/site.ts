/*
 * The public site (apps/site, ADR-0023) for «Открыть на сайте». The address is inlined when admin is built:
 * next.config.js takes it from SITE_ORIGIN (`.env` in dev, the build arg of the proxy image). Empty — no link.
 */
import type { UiLocale } from '@pharmacy/shared-dto';

const siteOrigin = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? '').replace(
  /\/+$/,
  '',
);

/** The address of a published article on the site, or `null` when admin was built without the site address. */
export function siteArticleUrl(locale: UiLocale, slug: string): string | null {
  if (siteOrigin === '') return null;
  const prefix = locale === 'tg' ? '/tg' : '';
  return `${siteOrigin}${prefix}/blog/${encodeURIComponent(slug)}`;
}
