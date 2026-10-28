import { Injectable } from '@nestjs/common';
import type {
  Article,
  ArticleListItem,
  ArticleStatus,
  ArticleTranslation,
  PublicArticle,
  PublicArticleListItem,
  PublicSitemap,
  SaveArticleRequest,
  UiLocale,
} from '@pharmacy/shared-dto';
import {
  parseSiteMarkdown,
  siteMarkdownMediaIds,
  toAppDate,
} from '@pharmacy/shared-util';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { type DB, isUniqueViolation, newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import {
  type ArticleState,
  SiteContentRepository,
} from './site-content.repository';

const LOCALES: UiLocale[] = ['ru', 'tg'];
const notFound = () => new ProblemException(404, 'article_not_found');

/** A translation with nothing in it: the language is not filled in, nothing is saved for it. */
const isBlank = (t: ArticleTranslation): boolean =>
  t.title === '' &&
  t.excerpt === '' &&
  t.body === '' &&
  t.seoTitle === '' &&
  t.seoDescription === '';

// The articles of the blog (spec 2026-10-28-public-site-design, 6.1, 7.1–7.2; A6): the operator edits them, the public
// site lists and renders the published ones and builds sitemap.xml from the feed. Rows are never deleted: an article
// leaves the work by `archive` (a draft only) or `unpublish`. Every change raises `version`.
@Injectable()
export class ArticlesService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: SiteContentRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  // ── Operator ──────────────────────────────────────────────────────────────────────────

  list(
    filter: { status?: ArticleStatus; q?: string },
    limit: number,
    offset: number,
  ): Promise<{ items: ArticleListItem[]; total: number }> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.listArticles(trx, filter, limit, offset),
    );
  }

  /** 404 `article_not_found`. */
  async get(id: string): Promise<Article> {
    const found = await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.article(trx, id),
    );
    if (found === null) throw notFound();
    return found;
  }

  /** 400 `validation_failed`, 400 `media_not_found`, 409 `slug_taken`. The new article is a draft of version 1. */
  async create(body: SaveArticleRequest): Promise<Article> {
    const actor = this.actor();
    const translations = this.readTranslations(body.translations);
    try {
      return await this.db.platformTransaction(actor, async (trx) => {
        await this.requireMedia(trx, body.coverMediaId, translations);
        const id = newId();
        await this.repository.insertArticle(trx, {
          id,
          slug: body.slug,
          coverMediaId: body.coverMediaId,
          operatorId: actor.operatorId,
        });
        for (const [locale, t] of translations)
          await this.repository.upsertArticleTranslation(trx, id, locale, t);
        await this.audit.append(trx, {
          action: 'article.created',
          entityType: 'article',
          entityId: id,
          details: { slug: body.slug, status: 'draft' },
        });
        return (await this.repository.article(trx, id)) as Article;
      });
    } catch (error) {
      throw this.slugTaken(error);
    }
  }

  /**
   * The save replaces the slug, the cover and the given languages (a language that is not given stays as it was). 400
   * `validation_failed` (no `version`, or a title shorter than 3), 400 `media_not_found`; 404 `article_not_found`;
   * 409 `archived`, `version_conflict`, `slug_locked` (the slug of an article that was published), `slug_taken`.
   */
  async update(id: string, body: SaveArticleRequest): Promise<Article> {
    if (body.version === undefined)
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'version', code: 'is_required' },
      ]);
    const version = body.version;
    const actor = this.actor();
    const translations = this.readTranslations(body.translations);
    try {
      return await this.db.platformTransaction(actor, async (trx) => {
        const current = await this.repository.articleState(trx, id);
        if (current === null) throw notFound();
        if (current.status === 'archived')
          throw new ProblemException(409, 'archived');
        if (current.version !== version)
          throw new ProblemException(409, 'version_conflict');
        // A6: the address of a published article is in the search engines, it does not change.
        if (body.slug !== current.slug && current.publishedAt !== null)
          throw new ProblemException(409, 'slug_locked');
        await this.requireMedia(trx, body.coverMediaId, translations);
        // Two saves of the same version: the second waits for the first and then matches no row.
        const saved = await this.repository.updateArticleVersioned(
          trx,
          id,
          version,
          { slug: body.slug, coverMediaId: body.coverMediaId },
          actor.operatorId,
        );
        if (!saved) throw new ProblemException(409, 'version_conflict');
        for (const [locale, t] of translations)
          await this.repository.upsertArticleTranslation(trx, id, locale, t);
        await this.audit.append(trx, {
          action: 'article.updated',
          entityType: 'article',
          entityId: id,
          details: { slug: body.slug, status: current.status },
        });
        return (await this.repository.article(trx, id)) as Article;
      });
    } catch (error) {
      throw this.slugTaken(error);
    }
  }

  /**
   * Draft or unpublished → published; `published_at` keeps the date of the first publication. 400
   * `translation_required` (no RU with a title and a text); 404; 409 `archived`, `already_published`.
   */
  publish(id: string): Promise<Article> {
    return this.changeStatus(
      id,
      'published',
      'article.published',
      (current, translations) => {
        if (current.status === 'published')
          throw new ProblemException(409, 'already_published');
        const ru = translations.ru;
        if (ru === undefined || ru.title === '' || ru.body === '')
          throw new ProblemException(400, 'translation_required');
      },
    );
  }

  /** Published → unpublished (the page leaves the site; the address stays reserved). 404; 409 `archived`, `not_published`. */
  unpublish(id: string): Promise<Article> {
    return this.changeStatus(
      id,
      'unpublished',
      'article.unpublished',
      (current) => {
        if (current.status !== 'published')
          throw new ProblemException(409, 'not_published');
      },
    );
  }

  /** Draft → archived (nothing is deleted). 404; 409 `archived`, `not_draft`. */
  archive(id: string): Promise<Article> {
    return this.changeStatus(id, 'archived', 'article.archived', (current) => {
      if (current.status !== 'draft')
        throw new ProblemException(409, 'not_draft');
    });
  }

  private changeStatus(
    id: string,
    next: ArticleStatus,
    action: string,
    rule: (
      current: ArticleState,
      translations: Partial<Record<UiLocale, ArticleTranslation>>,
    ) => void,
  ): Promise<Article> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const current = await this.repository.articleState(trx, id, true);
      if (current === null) throw notFound();
      if (current.status === 'archived')
        throw new ProblemException(409, 'archived');
      const stored = (await this.repository.article(trx, id)) as Article;
      rule(current, stored.translations);
      await this.repository.setArticleStatus(trx, id, next, actor.operatorId);
      await this.audit.append(trx, {
        action,
        entityType: 'article',
        entityId: id,
        details: { slug: current.slug, status: next },
      });
      return (await this.repository.article(trx, id)) as Article;
    });
  }

  /**
   * The languages of the request as `[locale, translation]`; a blank language is dropped. A language that is not
   * blank needs a title of at least 3 characters (the check of the table).
   */
  private readTranslations(
    given: SaveArticleRequest['translations'],
  ): [UiLocale, ArticleTranslation][] {
    const result: [UiLocale, ArticleTranslation][] = [];
    for (const locale of LOCALES) {
      const t = given[locale];
      if (t === undefined || isBlank(t)) continue;
      if (t.title.length < 3)
        throw new FieldProblemException(400, 'validation_failed', [
          { field: `translations.${locale}.title`, code: 'min_length' },
        ]);
      result.push([locale, t]);
    }
    return result;
  }

  /** 400 `media_not_found` for the cover or a picture of a text that is not stored. */
  private async requireMedia(
    trx: Transaction<DB>,
    coverMediaId: string | null,
    translations: [UiLocale, ArticleTranslation][],
  ): Promise<void> {
    const ids = new Set<string>();
    if (coverMediaId !== null) ids.add(coverMediaId);
    for (const [, t] of translations)
      for (const mediaId of siteMarkdownMediaIds(parseSiteMarkdown(t.body)))
        ids.add(mediaId);
    if ((await this.repository.missingMedia(trx, [...ids])).length > 0)
      throw new ProblemException(400, 'media_not_found');
  }

  /** A second article with the same slug (archived ones keep theirs): 409 `slug_taken`. */
  private slugTaken(error: unknown): unknown {
    return isUniqueViolation(error)
      ? new ProblemException(409, 'slug_taken')
      : error;
  }

  // ── Public (no session: a system actor reads) ─────────────────────────────────────────

  publicList(
    locale: UiLocale,
    limit: number,
    offset: number,
  ): Promise<{ items: PublicArticleListItem[]; total: number }> {
    return this.db.platformTransaction(
      { kind: 'system', job: 'site.public-read' },
      (trx) => this.repository.publicArticles(trx, locale, limit, offset),
    );
  }

  /** 404 `article_not_found`: not published, or no text in the language (P11). */
  async publicArticle(slug: string, locale: UiLocale): Promise<PublicArticle> {
    const found = await this.db.platformTransaction(
      { kind: 'system', job: 'site.public-read' },
      (trx) => this.repository.publicArticle(trx, slug, locale),
    );
    if (found === null) throw notFound();
    return found;
  }

  /**
   * The published articles and the legal documents in force with their languages, for `sitemap.xml`. The date of a
   * document is the publication of its newest current revision among the languages.
   */
  sitemap(): Promise<PublicSitemap> {
    return this.db.platformTransaction(
      { kind: 'system', job: 'site.public-read' },
      async (trx) => {
        const articles = await this.repository.sitemapArticles(trx);
        const revisions = await this.repository.currentLegalRevisions(
          trx,
          toAppDate(),
        );
        const legal: PublicSitemap['legal'] = [];
        for (const revision of revisions) {
          const entry = legal.find((known) => known.kind === revision.kind);
          if (entry === undefined)
            legal.push({
              kind: revision.kind,
              locales: [revision.locale],
              updatedAt: revision.publishedAt,
            });
          else {
            entry.locales.push(revision.locale);
            if (revision.publishedAt > entry.updatedAt)
              entry.updatedAt = revision.publishedAt;
          }
        }
        return { articles, legal };
      },
    );
  }
}
