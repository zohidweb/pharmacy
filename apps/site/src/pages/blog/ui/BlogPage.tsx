/*
 * The list of articles (spec 6.1, W7; redesign 4.6): 12 per page, the newest first, only those with a text in the
 * page's language. A page past the last one is a 404; an empty blog says so on its first page.
 * Each card is one link (its title stretched over the card). Without a cover the card shows a colour tile instead.
 * The cards rise in one after another by the CSS entrance, 0.06 s apart (no `motion` on this page); with reduce and
 * without JavaScript they are simply there.
 */
import type { PublicArticleListItem, UiLocale } from '@pharmacy/shared-dto';
import { buttonClassName, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { ARTICLES_PER_PAGE, getArticles, mediaPath } from '@/shared/api';
import { getTranslator } from '@/shared/i18n';
import { localePath, publicationDate } from '@/shared/lib';
import {
  pageClassName,
  pageHeaderClassName,
  pageLeadClassName,
  pageTitleClassName,
  pressClassName,
} from '@/shared/ui';
import { blogPagePath } from '../model/page-number';

export interface BlogPageProps {
  locale: UiLocale;
  /** A valid page number (`blogPageNumber`), from 1. */
  page: number;
}

/** A card's place in the cascade (site-theme.css, `.site-enter-stagger`). */
function enterAt(index: number): CSSProperties {
  return { '--ph-site-enter-index': index } as CSSProperties;
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
    <article className="group relative flex h-full flex-col overflow-hidden rounded-site-card border border-site-line bg-surface transition-colors hover:border-primary">
      {article.coverMediaId ? (
        <img
          src={mediaPath(article.coverMediaId)}
          // the title right below names the article; the cover adds nothing to read aloud
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-16/9 w-full shrink-0 bg-surface-sunken object-cover"
        />
      ) : (
        // no cover: the colour tile of the site (the text colour on it, never mint: site-theme.css)
        <div
          aria-hidden="true"
          data-surface="green"
          className="flex aspect-16/9 shrink-0 items-end p-6 text-fg"
        >
          <Icon name="newspaper" size="xl" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-6">
        <time dateTime={published.date} className="text-sm text-fg-subtle">
          {published.label}
        </time>
        <h2 className="text-2xl font-bold tracking-tight text-balance wrap-break-word">
          {/* the whole card is the link: its box covers the card (the card is `relative`) */}
          <Link
            href={localePath(locale, `/blog/${article.slug}`)}
            className="transition-colors group-hover:text-accent-site after:absolute after:inset-0"
          >
            {article.title}
          </Link>
        </h2>
        {article.excerpt.trim() && (
          <p className="text-md text-fg-muted">{article.excerpt}</p>
        )}
      </div>
    </article>
  );
}

export async function BlogPage({ locale, page }: BlogPageProps) {
  const t = getTranslator(locale);
  const { items, total } = await getArticles(locale, page);
  const pages = Math.max(1, Math.ceil(total / ARTICLES_PER_PAGE));
  if (page > pages) notFound();
  const pageLinkClass = buttonClassName({
    variant: 'secondary',
    className: pressClassName,
  });
  return (
    <main className={`@container ${pageClassName}`}>
      <header className={pageHeaderClassName}>
        <h1 className={pageTitleClassName}>{t('blog.title')}</h1>
        <p className={pageLeadClassName}>{t('blog.description')}</p>
      </header>

      {items.length === 0 ? (
        <p className="text-lead text-fg-muted">{t('blog.empty')}</p>
      ) : (
        // two columns once the column fits two cards, three from 1024 px (the container rule stops there, so the two
        // queries never compete for the same width)
        <ul className="grid gap-4 @xl:max-md:grid-cols-2 md:grid-cols-3">
          {items.map((article, index) => (
            <li
              key={article.slug}
              className="site-enter site-enter-stagger"
              style={enterAt(index)}
            >
              <ArticleCard locale={locale} article={article} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav
          aria-label={t('blog.pagination')}
          className="flex flex-wrap items-center gap-4 border-t border-site-line pt-8"
        >
          {page > 1 && (
            <Link
              href={localePath(locale, blogPagePath(page - 1))}
              rel="prev"
              className={pageLinkClass}
            >
              {t('blog.previous')}
            </Link>
          )}
          <span className="text-md text-fg-muted">
            {t('blog.pageOf', { page, pages })}
          </span>
          {page < pages && (
            <Link
              href={localePath(locale, blogPagePath(page + 1))}
              rel="next"
              className={pageLinkClass}
            >
              {t('blog.next')}
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
