/*
 * An article of the blog (spec 6.1, 6.6): title, date, cover and the restricted Markdown text drawn by the
 * shared SiteMarkdown (W9) — no HTML from the text reaches the page. The link to the other language is
 * shown only when the article exists in it (Review Focus 2).
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { parseSiteMarkdown } from '@pharmacy/shared-util';
import { SiteMarkdown } from '@pharmacy/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { mediaPath } from '@/shared/api';
import { getTranslator } from '@/shared/i18n';
import { localePath, publicationDate } from '@/shared/lib';
import { loadArticle } from '../model/load-article';

export interface ArticlePageProps {
  locale: UiLocale;
  slug: string;
}

export async function ArticlePage({ locale, slug }: ArticlePageProps) {
  const article = await loadArticle(slug, locale);
  if (!article) notFound();
  const t = getTranslator(locale);
  const published = publicationDate(article.publishedAt);
  const other: UiLocale = locale === 'ru' ? 'tg' : 'ru';
  const linkClass = 'text-sm text-primary hover:underline';
  return (
    <main className="mx-auto flex w-full max-w-(--ph-size-dialog-lg) flex-col gap-6 px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href={localePath(locale, '/blog')} className={linkClass}>
          <span aria-hidden="true">← </span>
          {t('blog.allArticles')}
        </Link>
        {article.locales.includes(other) && (
          // another document (`<html lang>`, header, footer): a plain link, not a client transition
          <a
            href={localePath(other, `/blog/${article.slug}`)}
            hrefLang={other}
            className={linkClass}
          >
            {t('blog.otherLanguage')}
          </a>
        )}
      </div>
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            {article.title}
          </h1>
          <time dateTime={published.date} className="text-sm text-fg-subtle">
            {published.label}
          </time>
        </header>
        {article.coverMediaId && (
          <img
            src={mediaPath(article.coverMediaId)}
            // decorative: the title above names the article
            alt=""
            className="aspect-video w-full rounded-md bg-surface-sunken object-cover"
          />
        )}
        <SiteMarkdown
          blocks={parseSiteMarkdown(article.body)}
          mediaSrc={mediaPath}
          links="external-new-tab"
        />
      </article>
    </main>
  );
}
