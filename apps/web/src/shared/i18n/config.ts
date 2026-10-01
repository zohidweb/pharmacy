/*
 * i18n of the client product (ADR-0015, ось 5): use-intl on the client, RU by default, TJ loaded on demand.
 * Keys are English identifiers; the RU dictionary is the source of truth for the key set
 * (typed via AppConfig in ./use-intl.d.ts). Money and dates are formatted by @pharmacy/shared-util.
 */
import ru from './messages/ru.json';

export type Messages = typeof ru;

export const locales = ['ru', 'tg'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ru';

export const APP_TIME_ZONE = 'Asia/Dushanbe';

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' && (locales as readonly string[]).includes(value)
  );
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === 'ru') return ru;
  const tg = await import('./messages/tg.json');
  return tg.default;
}

export const defaultMessages: Messages = ru;
