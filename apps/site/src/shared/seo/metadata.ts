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
  /**
   * The languages the page exists in (hreflang); both by default. A page shown in a language it does not
   * exist in (a legal document in RU on `/tg/...`) takes the canonical of the first language it exists in.
   */
  available?: readonly UiLocale[];
  /** The link preview picture; the default one of the settings when absent or `null`. */
  imageId?: string | null;
  /** An article: Open Graph `article` with its dates (ISO instants). */
  article?: { publishedTime: string; modifiedTime: string };
}

/** Description, canonical with hreflang of the page's languages, Open Graph with its picture. */
export function pageMetadata({
  locale,
  path,
  info,
  title,
  openGraphTitle,
  description,
  available = locales,
  imageId,
  article,
}: PageMetadataInput): Metadata {
  const canonicalLocale = available.includes(locale)
    ? locale
    : (available[0] ?? locale);
  const links = alternates(path, available, canonicalLocale);
  const image = imageId || info?.settings.ogImageMediaId;
  const openGraph = {
    title: openGraphTitle,
    description,
    url: links.canonical,
    siteName: siteNameOf(info, locale),
    // the language of the canonical page: /tg/privacy that shows the RU text is a RU page (the description stays TG)
    locale: OPEN_GRAPH_LOCALES[canonicalLocale],
    ...(image && { images: [absoluteUrl(mediaPath(image))] }),
  };
  return {
    title,
    description,
    alternates: links,
    openGraph: article
      ? { ...openGraph, type: 'article', ...article }
      : { ...openGraph, type: 'website' },
  };
}
