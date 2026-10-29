/*
 * Mock handlers of the «Сайт» block: connection requests, articles, legal documents, pictures and the
 * settings of the public site. Plain in-memory logic, enough for development and the screens' tests:
 * no spam rules, limits or fresh-sign-in check (spec 2026-10-28-public-site-admin, S10).
 */
import type {
  Article,
  ArticleListItem,
  ArticleTranslation,
  ConnectionRequest,
  ConnectionRequestListItem,
  ConnectionRequestStatus,
  LegalDocumentKind,
  UiLocale,
} from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import { mockDb } from './db';
import { describeImage } from './db-site';
import { demoOperator } from './fixtures';
import { notFound } from './helpers';
import type { MockHandlers } from './types';

const site = () => mockDb().site;
const now = () => new Date().toISOString();

const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const OPEN_STATUSES: ConnectionRequestStatus[] = ['new', 'in_progress'];

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${Date.now()}-${nextId++}`;

function invalid(field: string, code: string, correlationId: string) {
  return new ApiError(400, 'validation_failed', correlationId, [
    { field, code },
  ]);
}

// ── Connection requests ───────────────────────────────────────────────────────────────────

function findRequest(id: string, correlationId: string): ConnectionRequest {
  const found = site().requests.find((item) => item.id === id);
  if (!found)
    throw new ApiError(404, 'connection_request_not_found', correlationId);
  return found;
}

/** A request that is `connected`, `rejected` or `spam` is final. */
function openRequest(id: string, correlationId: string): ConnectionRequest {
  const found = findRequest(id, correlationId);
  if (!OPEN_STATUSES.includes(found.status))
    throw new ApiError(409, 'request_already_decided', correlationId);
  return found;
}

function toListItem(item: ConnectionRequest): ConnectionRequestListItem {
  const {
    comment: _comment,
    operatorNote: _operatorNote,
    similarTenants: _similarTenants,
    ...rest
  } = item;
  return rest;
}

function decide(
  item: ConnectionRequest,
  status: 'rejected' | 'spam',
  rejectReason: string | null,
): ConnectionRequest {
  item.status = status;
  item.rejectReason = rejectReason;
  item.decidedAt = now();
  return item;
}

// ── Articles ──────────────────────────────────────────────────────────────────────────────

function findArticle(id: string, correlationId: string): Article {
  const found = site().articles.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'article_not_found', correlationId);
  return found;
}

const isBlank = (t: ArticleTranslation) =>
  [t.title, t.excerpt, t.body, t.seoTitle, t.seoDescription].every(
    (value) => value.trim() === '',
  );

/** A language is readable with a title and a text (the hidden one has an empty text). */
const isReadable = (t: ArticleTranslation | undefined): boolean =>
  t !== undefined && t.title.trim() !== '' && t.body.trim() !== '';

function requireMedia(id: string | null, correlationId: string): void {
  if (id !== null && !site().media.some((item) => item.id === id))
    throw new ApiError(400, 'media_not_found', correlationId);
}

function toArticleItem(article: Article): ArticleListItem {
  return {
    id: article.id,
    slug: article.slug,
    status: article.status,
    titleRu: article.translations.ru?.title ?? '',
    locales: (['ru', 'tg'] as const).filter((locale) =>
      isReadable(article.translations[locale]),
    ),
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
  };
}

/** Every save and every status change raises the version. */
function touch(article: Article): Article {
  article.version += 1;
  article.updatedAt = now();
  return article;
}

function writableArticle(id: string, correlationId: string): Article {
  const article = findArticle(id, correlationId);
  if (article.status === 'archived')
    throw new ApiError(409, 'archived', correlationId);
  return article;
}

/** A given language replaces the saved one; an absent or all-empty one stays as it was. */
function mergeTranslations(
  article: Article,
  given: Partial<Record<UiLocale, ArticleTranslation>>,
  correlationId: string,
): void {
  for (const locale of ['ru', 'tg'] as const) {
    const t = given[locale];
    if (t == null || isBlank(t)) continue;
    if ([...t.title.trim()].length < 3)
      throw invalid(
        `translations.${locale}.title`,
        'min_length',
        correlationId,
      );
  }
  for (const locale of ['ru', 'tg'] as const) {
    const t = given[locale];
    if (t == null || isBlank(t)) continue;
    article.translations[locale] = {
      title: t.title.trim(),
      excerpt: t.excerpt.trim(),
      body: t.body.trim(),
      seoTitle: t.seoTitle.trim(),
      seoDescription: t.seoDescription.trim(),
    };
  }
}

// ── Legal documents ───────────────────────────────────────────────────────────────────────

const KINDS: LegalDocumentKind[] = ['offer', 'privacy'];
const LOCALES: UiLocale[] = ['ru', 'tg'];

function checkKindAndLocale(
  kind: string,
  locale: string,
  correlationId: string,
): void {
  if (
    !(KINDS as string[]).includes(kind) ||
    !(LOCALES as string[]).includes(locale)
  )
    throw notFound(correlationId);
}

export const siteHandlers: Pick<
  MockHandlers,
  | 'connectionRequests.list'
  | 'connectionRequests.get'
  | 'connectionRequests.take'
  | 'connectionRequests.reject'
  | 'connectionRequests.markSpam'
  | 'connectionRequests.note'
  | 'articles.list'
  | 'articles.get'
  | 'articles.create'
  | 'articles.update'
  | 'articles.publish'
  | 'articles.unpublish'
  | 'articles.archive'
  | 'legalDocuments.overview'
  | 'legalDocuments.saveDraft'
  | 'legalDocuments.publish'
  | 'siteMedia.list'
  | 'siteMedia.upload'
  | 'siteSettings.get'
  | 'siteSettings.update'
> = {
  'connectionRequests.list': ({ query }) => {
    // without a status — the open ones, as apps/api
    const statuses = query?.status
      ? query.status.split(',').map((value) => value.trim())
      : OPEN_STATUSES;
    const q = (query?.q ?? '').trim().toLocaleLowerCase('ru');
    const items = site()
      .requests.filter((item) => statuses.includes(item.status))
      .filter(
        (item) =>
          !q ||
          item.networkName.toLocaleLowerCase('ru').includes(q) ||
          (item.phone ?? '').includes(q),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toListItem);
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },
  'connectionRequests.get': ({ params, correlationId }) =>
    findRequest(params.id, correlationId),
  'connectionRequests.take': ({ params, correlationId }) => {
    const item = openRequest(params.id, correlationId);
    item.status = 'in_progress';
    item.assignedTo = { id: demoOperator.id, fullName: demoOperator.fullName };
    return item;
  },
  'connectionRequests.reject': ({ params, body, correlationId }) => {
    const reason = body.reason.trim();
    if (reason.length < 5 || reason.length > 500)
      throw invalid('reason', 'length', correlationId);
    return decide(openRequest(params.id, correlationId), 'rejected', reason);
  },
  'connectionRequests.markSpam': ({ params, correlationId }) =>
    decide(openRequest(params.id, correlationId), 'spam', null),
  'connectionRequests.note': ({ params, body, correlationId }) => {
    const item = findRequest(params.id, correlationId);
    if (item.anonymizedAt)
      throw new ApiError(409, 'request_already_decided', correlationId);
    const note = body.note.trim();
    if (note.length > 1000) throw invalid('note', 'max_length', correlationId);
    item.operatorNote = note === '' ? null : note;
    return item;
  },

  'articles.list': ({ query }) => {
    const q = (query?.q ?? '').trim().toLocaleLowerCase('ru');
    const items = site()
      .articles.filter((item) =>
        query?.status
          ? item.status === query.status
          : item.status !== 'archived',
      )
      .filter(
        (item) =>
          !q ||
          (item.translations.ru?.title ?? '')
            .toLocaleLowerCase('ru')
            .includes(q),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toArticleItem);
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },
  'articles.get': ({ params, correlationId }) =>
    findArticle(params.id, correlationId),
  'articles.create': ({ body, correlationId }) => {
    if (site().articles.some((item) => item.slug === body.slug))
      throw new ApiError(409, 'slug_taken', correlationId);
    requireMedia(body.coverMediaId, correlationId);
    const article: Article = {
      id: newId('ar'),
      slug: body.slug,
      status: 'draft',
      coverMediaId: body.coverMediaId,
      publishedAt: null,
      updatedAt: now(),
      version: 1,
      translations: {},
    };
    mergeTranslations(article, body.translations, correlationId);
    site().articles.push(article);
    return article;
  },
  'articles.update': ({ params, body, correlationId }) => {
    if (body.version === undefined)
      throw invalid('version', 'is_required', correlationId);
    const article = writableArticle(params.id, correlationId);
    if (body.version !== article.version)
      throw new ApiError(409, 'version_conflict', correlationId);
    if (body.slug !== article.slug) {
      if (article.publishedAt !== null)
        throw new ApiError(409, 'slug_locked', correlationId);
      if (site().articles.some((item) => item.slug === body.slug))
        throw new ApiError(409, 'slug_taken', correlationId);
    }
    requireMedia(body.coverMediaId, correlationId);
    mergeTranslations(article, body.translations, correlationId);
    article.slug = body.slug;
    article.coverMediaId = body.coverMediaId;
    return touch(article);
  },
  'articles.publish': ({ params, correlationId }) => {
    const article = writableArticle(params.id, correlationId);
    if (article.status === 'published')
      throw new ApiError(409, 'already_published', correlationId);
    if (!isReadable(article.translations.ru))
      throw new ApiError(400, 'translation_required', correlationId);
    article.status = 'published';
    // the first date stays
    article.publishedAt ??= now();
    return touch(article);
  },
  'articles.unpublish': ({ params, correlationId }) => {
    const article = writableArticle(params.id, correlationId);
    if (article.status !== 'published')
      throw new ApiError(409, 'not_published', correlationId);
    article.status = 'unpublished';
    return touch(article);
  },
  'articles.archive': ({ params, correlationId }) => {
    const article = writableArticle(params.id, correlationId);
    if (article.status !== 'draft')
      throw new ApiError(409, 'not_draft', correlationId);
    article.status = 'archived';
    return touch(article);
  },

  'legalDocuments.overview': () => ({
    drafts: site().legalDrafts,
    revisions: site().legalRevisions.map(({ body: _body, ...rest }) => rest),
  }),
  'legalDocuments.saveDraft': ({ params, body, correlationId }) => {
    checkKindAndLocale(params.kind, params.locale, correlationId);
    const title = body.title.trim();
    if ([...title].length < 3)
      throw invalid('title', 'min_length', correlationId);
    if (body.body.trim() === '')
      throw invalid('body', 'is_required', correlationId);
    const draft = {
      kind: params.kind,
      locale: params.locale,
      title,
      body: body.body.trim(),
      effectiveFrom: body.effectiveFrom,
      updatedAt: now(),
    };
    const drafts = site().legalDrafts;
    const at = drafts.findIndex(
      (item) => item.kind === params.kind && item.locale === params.locale,
    );
    if (at >= 0) drafts[at] = draft;
    else drafts.push(draft);
    return draft;
  },
  'legalDocuments.publish': ({ params, correlationId }) => {
    checkKindAndLocale(params.kind, params.locale, correlationId);
    const draft = site().legalDrafts.find(
      (item) => item.kind === params.kind && item.locale === params.locale,
    );
    if (!draft) throw new ApiError(409, 'draft_empty', correlationId);
    const latest = site().legalRevisions.find(
      (item) => item.kind === params.kind && item.locale === params.locale,
    );
    // a draft equal to the last revision publishes nothing
    if (
      latest &&
      latest.title === draft.title &&
      latest.body === draft.body &&
      latest.effectiveFrom === draft.effectiveFrom
    )
      return latest;
    if (draft.effectiveFrom < toAppDate())
      throw invalid('effectiveFrom', 'is_not_in_the_past', correlationId);
    const revision = {
      id: newId(`ldr-${params.kind}-${params.locale}`),
      kind: params.kind,
      locale: params.locale,
      title: draft.title,
      body: draft.body,
      effectiveFrom: draft.effectiveFrom,
      publishedAt: now(),
    };
    site().legalRevisions.unshift(revision);
    return revision;
  },

  'siteMedia.list': ({ query }) => {
    const items = [...site().media].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },
  'siteMedia.upload': ({ body, correlationId }) => {
    const image = describeImage(body.dataBase64);
    if (image.byteSize > MAX_MEDIA_BYTES)
      throw new ApiError(413, 'media_too_large', correlationId);
    const media = {
      id: newId('sm'),
      contentType: body.contentType,
      ...image,
      alt: body.alt.trim(),
      createdAt: now(),
    };
    site().media.push(media);
    return media;
  },

  'siteSettings.get': () => site().settings,
  'siteSettings.update': ({ body, correlationId }) => {
    for (const mediaId of [
      body.logoMediaId,
      body.faviconMediaId,
      body.ogImageMediaId,
    ])
      requireMedia(mediaId, correlationId);
    site().settings = { ...body, updatedAt: now() };
    return site().settings;
  },
};
