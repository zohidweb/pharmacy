import type { UiLocale } from '@pharmacy/shared-dto';
import { siteEnv } from '@/shared/config';

/** Address of a page in a language: RU without a prefix, TJ under /tg (spec 6.1). `path` starts with `/`. */
export function localePath(locale: UiLocale, path: string): string {
  if (locale === 'ru') return path;
  return path === '/' ? '/tg' : `/tg${path}`;
}

/** Absolute address on the public origin (canonical, hreflang, sitemap). Server only. */
export function absoluteUrl(path: string): string {
  return siteEnv().siteOrigin + path;
}
