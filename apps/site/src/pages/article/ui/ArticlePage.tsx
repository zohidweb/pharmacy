/*
 * An article of the blog (spec 6.1, 6.6; redesign 4.6): title, date, cover and the restricted Markdown text drawn by
 * the shared SiteMarkdown (W9); no HTML from the text reaches the page. The link to the other language is shown only
 * when the article exists in it (Review Focus 2). A reading column of 68 characters; the cover takes its full width;
 * the text takes the theme's colours and the column's sizes from the tokens (`.site-prose`), the kit is unchanged.
 * No `motion`: only the heading rises in by CSS.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { parseSiteMarkdown } from '@pharmacy/shared-util';
import { Icon, SiteMarkdown } from '@pharmacy/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { mediaPath } from '@/shared/api';
import { getTranslator } from '@/shared/i18n';
import { localePath, publicationDate } from '@/shared/lib';
import { readingColumnClassName, readingTitleClassName } from '@/shared/ui';
import { loadArticle } from '../model/load-article';

export interface ArticlePageProps {
  locale: UiLocale;
  slug: string;
}

const linkClass =
  'inline-flex min-h-touch items-center gap-1 text-md font-semibold text-accent-site transition-colors ' +
  'hover:text-primary-hover';

export async function ArticlePage({ locale, slug }: ArticlePageProps) {
  const article = await loadArticle(slug, locale);
  if (!article) notFound();
  const t = getTranslator(locale);
  const published = publicationDate(article.publishedAt);
  const other: UiLocale = locale === 'ru' ? 'tg' : 'ru';
  return (
    <main className="px-4 py-16">
      <div className={readingColumnClassName}>
        <div className="flex flex-wrap items-center justify-between gap-x-6">
          <Link href={localePath(locale, '/blog')} className={linkClass}>
            <Icon name="chevron-left" size="sm" />
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
        <article className="flex flex-col gap-8">
          <header className="flex flex-col gap-4">
            <h1 className={readingTitleClassName}>{article.title}</h1>
            <time
              dateTime={published.date}
              className="site-enter site-enter-delay-1 text-md text-fg-subtle"
            >
              {published.label}
            </time>
          </header>
          {article.coverMediaId && (
            <img
              src={mediaPath(article.coverMediaId)}
              // decorative: the title above names the article
              alt=""
              decoding="async"
              className="aspect-16/9 w-full rounded-site-card bg-surface-sunken object-cover"
            />
          )}
          <div className="site-prose">
            <SiteMarkdown
              blocks={parseSiteMarkdown(article.body)}
              mediaSrc={mediaPath}
              links="external-new-tab"
            />
          </div>
        </article>
      </div>
    </main>
  );
}
