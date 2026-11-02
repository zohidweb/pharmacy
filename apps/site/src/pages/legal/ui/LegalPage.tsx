/*
 * The public offer and the privacy policy (spec 6.1): the revision in force — title, «Действует с <дата>»
 * and the text drawn by the shared SiteMarkdown (W9). Without a TJ revision the API gives the RU one: the
 * text is marked `lang="ru"` and the page says the text is in Russian.
 */
import type { LegalDocumentKind, UiLocale } from '@pharmacy/shared-dto';
import { formatDateOnly, parseSiteMarkdown } from '@pharmacy/shared-util';
import { SiteMarkdown } from '@pharmacy/ui';
import { notFound } from 'next/navigation';
import { getLegalDocument, mediaPath } from '@/shared/api';
import { getTranslator } from '@/shared/i18n';

export interface LegalPageProps {
  kind: LegalDocumentKind;
  locale: UiLocale;
}

export async function LegalPage({ kind, locale }: LegalPageProps) {
  const revision = await getLegalDocument(kind, locale);
  if (!revision) notFound();
  const t = getTranslator(locale);
  // the title and the text are in the revision's language; the rest of the page — in the page's one
  const textLang = revision.locale !== locale ? revision.locale : undefined;
  return (
    <main className="mx-auto flex w-full max-w-(--ph-size-dialog-lg) flex-col gap-6 px-4 py-12">
      {textLang && (
        <p className="rounded-md bg-surface-sunken px-4 py-3 text-sm text-fg-muted">
          {t('legal.russianOnly')}
        </p>
      )}
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1
            lang={textLang}
            className="text-2xl font-bold tracking-tight lg:text-3xl"
          >
            {revision.title}
          </h1>
          <p className="text-sm text-fg-subtle">
            {t('legal.effectiveFrom', {
              date: formatDateOnly(revision.effectiveFrom),
            })}
          </p>
        </header>
        <div lang={textLang}>
          <SiteMarkdown
            blocks={parseSiteMarkdown(revision.body)}
            mediaSrc={mediaPath}
            links="external-new-tab"
          />
        </div>
      </article>
    </main>
  );
}
