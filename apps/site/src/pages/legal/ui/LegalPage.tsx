/*
 * The public offer and the privacy policy (spec 6.1; redesign 4.6): the revision in force, its title,
 * «Действует с <дата>» and the text drawn by the shared SiteMarkdown (W9). Without a TJ revision the API gives the RU
 * one: the text is marked `lang="ru"` and the page says the text is in Russian. A calm reading column of 68
 * characters in the theme's colours (`.site-prose`); nothing moves but the heading's entrance.
 */
import type { LegalDocumentKind, UiLocale } from '@pharmacy/shared-dto';
import { formatDateOnly, parseSiteMarkdown } from '@pharmacy/shared-util';
import { SiteMarkdown } from '@pharmacy/ui';
import { notFound } from 'next/navigation';
import { getLegalDocument, mediaPath } from '@/shared/api';
import { getTranslator } from '@/shared/i18n';
import { readingColumnClassName, readingTitleClassName } from '@/shared/ui';

export interface LegalPageProps {
  kind: LegalDocumentKind;
  locale: UiLocale;
}

export async function LegalPage({ kind, locale }: LegalPageProps) {
  const revision = await getLegalDocument(kind, locale);
  if (!revision) notFound();
  const t = getTranslator(locale);
  // the title and the text are in the revision's language; the rest of the page is in the page's one
  const textLang = revision.locale !== locale ? revision.locale : undefined;
  return (
    <main className="px-4 py-16">
      <div className={readingColumnClassName}>
        {textLang && (
          <p className="rounded-site-card border border-site-line bg-surface px-6 py-4 text-md text-fg-muted">
            {t('legal.russianOnly')}
          </p>
        )}
        <article className="flex flex-col gap-8">
          <header className="flex flex-col gap-4">
            <h1 lang={textLang} className={readingTitleClassName}>
              {revision.title}
            </h1>
            <p className="text-md text-fg-subtle">
              {t('legal.effectiveFrom', {
                date: formatDateOnly(revision.effectiveFrom),
              })}
            </p>
          </header>
          <div lang={textLang} className="site-prose">
            <SiteMarkdown
              blocks={parseSiteMarkdown(revision.body)}
              mediaSrc={mediaPath}
              links="external-new-tab"
            />
          </div>
        </article>
      </div>
    </main>
  );
}
