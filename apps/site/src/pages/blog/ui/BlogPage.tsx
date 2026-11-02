/*
 * The list of articles (spec 6.1, W7): 12 per page, the newest first, only those with a text in the page's
 * language. A page past the last one is a 404; an empty blog says so on its first page.
 */
import type { PublicArticleListItem, UiLocale } from '@pharmacy/shared-dto';
import { buttonClassName, Card } from '@pharmacy/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ARTICLES_PER_PAGE, getArticles, mediaPath } from '@/shared/api';
import { getTranslator } from '@/shared/i18n';
import { localePath, publicationDate } from '@/shared/lib';
import { blogPagePath } from '../model/page-number';

export interface BlogPageProps {
  locale: UiLocale;
  /** A valid page number (`blogPageNumber`), from 1. */
  page: number;
}

function ArticleCard({
  locale,
  article,
}: {
  locale: UiLocale;
  article: PublicArticleListItem;
}) {
  const published = publicationDate(article.publishedAt);
  return (
    <Card as="article" padding="none" className="flex h-full flex-col">
      {article.coverMediaId && (
        <img
          src={mediaPath(article.coverMediaId)}
          // the title right below names the article; the cover adds nothing to read aloud
          alt=""
          loading="lazy"
          className="aspect-video w-full bg-surface-sunken object-cover"
        />
      )}
      <div className="flex flex-1 flex-col gap-2 p-(--ph-card-padding)">
        <time dateTime={published.date} className="text-xs text-fg-subtle">
          {published.label}
        </time>
        <h2 className="text-md font-semibold">
          <Link
            href={localePath(locale, `/blog/${article.slug}`)}
            className="hover:text-primary hover:underline"
          >
            {article.title}
          </Link>
        </h2>
        {article.excerpt.trim() && (
          <p className="text-sm text-fg-muted">{article.excerpt}</p>
        )}
      </div>
    </Card>
  );
}

export async function BlogPage({ locale, page }: BlogPageProps) {
  const t = getTranslator(locale);
  const { items, total } = await getArticles(locale, page);
  const pages = Math.max(1, Math.ceil(total / ARTICLES_PER_PAGE));
  if (page > pages) notFound();
  return (
    <main className="@container mx-auto flex w-full max-w-(--ph-size-dialog-xl) flex-col gap-8 px-4 py-12">
      <header className="flex max-w-(--ph-size-dialog-lg) flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          {t('blog.title')}
        </h1>
        <p className="text-fg-muted">{t('blog.description')}</p>
      </header>

      {items.length === 0 ? (
        <p className="text-fg-muted">{t('blog.empty')}</p>
      ) : (
        <ul className="grid gap-6 @xl:grid-cols-2 @4xl:grid-cols-3">
          {items.map((article) => (
            <li key={article.slug}>
              <ArticleCard locale={locale} article={article} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav
          aria-label={t('blog.pagination')}
          className="flex flex-wrap items-center gap-4 border-t border-border pt-6"
        >
          {page > 1 && (
            <Link
              href={localePath(locale, blogPagePath(page - 1))}
              rel="prev"
              className={buttonClassName({ variant: 'secondary' })}
            >
              {t('blog.previous')}
            </Link>
          )}
          <span className="text-sm text-fg-muted">
            {t('blog.pageOf', { page, pages })}
          </span>
          {page < pages && (
            <Link
              href={localePath(locale, blogPagePath(page + 1))}
              rel="next"
              className={buttonClassName({ variant: 'secondary' })}
            >
              {t('blog.next')}
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
