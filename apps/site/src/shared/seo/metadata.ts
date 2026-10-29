/*
 * Server-only helpers of the page metadata (spec 2, goal 2): the site name, canonical and hreflang,
 * Open Graph. Kept out of @/shared/lib, which client components import: these read the server env.
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { mediaPath } from '@/shared/api';
import { absoluteUrl } from '@/shared/config';
import { getTranslator, locales } from '@/shared/i18n';
import { localePath, pickText } from '@/shared/lib';

const OPEN_GRAPH_LOCALES: Record<UiLocale, string> = {
  ru: 'ru_RU',
  tg: 'tg_TJ',
};

/** The name from the settings; `brand.fallbackName` when it is empty or the API failed (W3). */
export function siteNameOf(
  info: PublicSiteInfo | null,
  locale: UiLocale,
): string {
  const name = info ? pickText(info.settings.name, locale).trim() : '';
  return name || getTranslator(locale)('brand.fallbackName');
}

/**
 * Canonical — the address of the current language; `languages` — only the given ones; `x-default` — RU
 * when RU is among them. Absolute addresses on SITE_ORIGIN.
 */
export function alternates(
  path: string,
  available: readonly UiLocale[],
  current: UiLocale,
): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = {};
  for (const locale of available) {
    languages[locale] = absoluteUrl(localePath(locale, path));
  }
  if (available.includes('ru')) {
    languages['x-default'] = absoluteUrl(localePath('ru', path));
  }
  return { canonical: absoluteUrl(localePath(current, path)), languages };
}

export interface PageMetadataInput {
  locale: UiLocale;
  /** The address without the language prefix, e.g. `/tariffs`. */
  path: string;
  info: PublicSiteInfo | null;
  /** The page title; the layout adds « — <site name>» to a plain string. */
  title: Metadata['title'];
  /** The title in link previews (no template there). */
  openGraphTitle: string;
  description: string;
}

/** Description, canonical with hreflang of both languages, Open Graph with the default picture. */
export function pageMetadata({
  locale,
  path,
  info,
  title,
  openGraphTitle,
  description,
}: PageMetadataInput): Metadata {
  const links = alternates(path, locales, locale);
  const imageId = info?.settings.ogImageMediaId;
  return {
    title,
    description,
    alternates: links,
    openGraph: {
      type: 'website',
      title: openGraphTitle,
      description,
      url: links.canonical,
      siteName: siteNameOf(info, locale),
      locale: OPEN_GRAPH_LOCALES[locale],
      ...(imageId && { images: [absoluteUrl(mediaPath(imageId))] }),
    },
  };
}
