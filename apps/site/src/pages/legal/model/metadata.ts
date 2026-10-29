import type {
  LegalDocumentKind,
  PublicSiteInfo,
  UiLocale,
} from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { getLegalDocument } from '@/shared/api';
import { getTranslator, locales } from '@/shared/i18n';
import { pageMetadata, siteNameOf } from '@/shared/seo';

/**
 * The title of the revision in force. hreflang — only the languages the document is published in (the API
 * answers a missing TJ with the RU text, `revision.locale` tells which): `/tg/offer` with the RU text is a
 * copy of `/offer` and takes its canonical. Nothing published — no metadata: the page answers 404.
 */
export async function legalMetadata(
  kind: LegalDocumentKind,
  locale: UiLocale,
  info: PublicSiteInfo | null,
): Promise<Metadata> {
  const revisions = await Promise.all(
    locales.map((language) => getLegalDocument(kind, language)),
  );
  const current = revisions[locales.indexOf(locale)];
  if (!current) return {};
  const available = locales.filter(
    (language, index) => revisions[index]?.locale === language,
  );
  return pageMetadata({
    locale,
    path: `/${kind}`,
    info,
    title: current.title,
    openGraphTitle: `${current.title} — ${siteNameOf(info, locale)}`,
    description: getTranslator(locale)(`legal.${kind}.description`),
    available,
  });
}
