'use client';

import type { SiteMedia, SiteMediaType } from '@pharmacy/shared-dto';
import { useTranslations } from 'use-intl';

/** The types the library accepts; the API checks the file signature, the admin only the declared type. */
export const siteMediaTypes: readonly SiteMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

export const isSiteMediaType = (value: string): value is SiteMediaType =>
  (siteMediaTypes as readonly string[]).includes(value);

/** The picture as the line of an article text: `![caption](media:<id>)` (restricted Markdown, ADR-0023). */
export function siteMediaEmbed(media: Pick<SiteMedia, 'id' | 'alt'>): string {
  // The caption ends at the first `]` and the line must stay one line.
  const caption = media.alt.replace(/[\]\r\n]+/g, ' ').trim();
  return `![${caption}](media:${media.id})`;
}

/** «512 КиБ» / «1,4 МиБ» in the language of the interface. */
export function useSiteMediaSizeText(): (bytes: number) => string {
  const t = useTranslations('site.media.size');
  return (bytes) => {
    // Round first, then choose the unit: 1023.7 КиБ is «1 МиБ», not «1024 КиБ».
    const kib = Math.max(1, Math.round(bytes / 1024));
    if (kib < 1024) return t('kib', { value: kib });
    return t('mib', { value: Math.round((bytes / 1024 / 1024) * 10) / 10 });
  };
}
