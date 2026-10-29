import type { UiLocale } from '@pharmacy/shared-dto';

/*
 * Client-safe: this segment is imported by client components (404 screen, language switch), so it never
 * reads the server environment — absolute addresses live in @/shared/config.
 */

/** Address of a page in a language: RU without a prefix, TJ under /tg (spec 6.1). `path` starts with `/`. */
export function localePath(locale: UiLocale, path: string): string {
  if (locale === 'ru') return path;
  return path === '/' ? '/tg' : `/tg${path}`;
}
