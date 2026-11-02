'use client';

/*
 * RU/TJ (spec 6.2, п. 1): ordinary links to the same page in the other language. The root layout cannot
 * know the page address without middleware, so the switch reads it in the browser. A plain <a>, not
 * next/link: the other language is another document (`<html lang>`, header, footer). Client-safe imports
 * only: no dictionaries, no server environment.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { usePathname } from 'next/navigation';
import { localePath } from '@/shared/lib';

const LANGUAGES: readonly { locale: UiLocale; label: string }[] = [
  { locale: 'ru', label: 'RU' },
  { locale: 'tg', label: 'TJ' },
];

/** The address without the language segment: `/tg/tariffs` → `/tariffs`, `/ru` (rewrite) → `/`. */
function pathWithoutLocale(pathname: string): string {
  return pathname.replace(/^\/(?:ru|tg)(?=\/|$)/, '') || '/';
}

/**
 * The page to open in the other language. An article may have no translation, and the layout cannot know:
 * the switch leads to the blog of the other language (the article itself links its translation).
 */
function otherLanguagePath(path: string): string {
  return /^\/blog\/[^/]+/.test(path) ? '/blog' : path;
}

export interface LocaleSwitchProps {
  locale: UiLocale;
  /** Accessible name of the group («Язык сайта»). */
  label: string;
}

export function LocaleSwitch({ locale, label }: LocaleSwitchProps) {
  const path = otherLanguagePath(pathWithoutLocale(usePathname() ?? '/'));
  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-1 rounded-sm bg-surface-sunken p-0.5">
        {LANGUAGES.map((language) => (
          <li key={language.locale}>
            {language.locale === locale ? (
              <span
                aria-current="true"
                className="flex min-h-touch min-w-touch items-center justify-center rounded-sm bg-surface text-sm font-semibold text-fg shadow-sm"
              >
                {language.label}
              </span>
            ) : (
              <a
                href={localePath(language.locale, path)}
                hrefLang={language.locale}
                lang={language.locale}
                className="flex min-h-touch min-w-touch items-center justify-center rounded-sm text-sm font-semibold text-fg-muted hover:text-fg"
              >
                {language.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
