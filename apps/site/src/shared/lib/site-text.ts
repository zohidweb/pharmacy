import type { SiteText, UiLocale } from '@pharmacy/shared-dto';

/** The text of the page's language; an empty translation falls back to RU. */
export function pickText(text: SiteText, locale: UiLocale): string {
  return text[locale].trim() ? text[locale] : text.ru;
}
