/*
 * i18n of the public site (spec 6.5): use-intl, RU and TJ. Server components translate with
 * `createTranslator`; the RU dictionary is the source of truth for the key set (parity test).
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { createTranslator } from 'use-intl/core';
import ru from './messages/ru.json';
import tg from './messages/tg.json';

export type Messages = typeof ru;

export const locales = ['ru', 'tg'] as const;

export const APP_TIME_ZONE = 'Asia/Dushanbe';

const dictionaries: Record<UiLocale, Messages> = { ru, tg };

export function isLocale(value: string): value is UiLocale {
  return (locales as readonly string[]).includes(value);
}

export function getMessages(locale: UiLocale): Messages {
  return dictionaries[locale];
}

export function getTranslator(locale: UiLocale) {
  return createTranslator({ locale, messages: getMessages(locale) });
}
