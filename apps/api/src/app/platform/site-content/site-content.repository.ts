import { Injectable } from '@nestjs/common';
import type {
  Article,
  ArticleListItem,
  ArticleStatus,
  ArticleTranslation,
  LegalDocumentDraft,
  LegalDocumentKind,
  LegalDocumentRevision,
  PublicArticle,
  PublicArticleListItem,
  PublicService,
  PublicSiteInfo,
  SiteMedia,
  SiteMediaType,
  SiteSettings,
  SiteText,
  UiLocale,
  UpdateSiteSettingsRequest,
} from '@pharmacy/shared-dto';
import { sql, type Transaction } from 'kysely';
import {
  type DB,
  escapeLike,
  PLATFORM_TIME_ZONE,
} from '../../../core/database';

const iso = (value: Date | string): string => new Date(value).toISOString();

const textOf = (value: unknown, key: string): string => {
  if (value === null || typeof value !== 'object') return '';
  const text = (value as Record<string, unknown>)[key];
  return typeof text === 'string' ? text : '';
};

/** A `{ru, tg}` text of a jsonb column; a missing language is an empty string. */
const siteText = (value: unknown): SiteText => ({
  ru: textOf(value, 'ru'),
  tg: textOf(value, 'tg'),
});

const textJson = (text: SiteText): string =>
  JSON.stringify({ ru: text.ru, tg: text.tg });

interface MediaRow {
  id: string;
  contentType: SiteMediaType;
  width: number;
  height: number;
  byteSize: number | string;
  alt: string;
  createdAt: Date | string;
}

const toMedia = (row: MediaRow): SiteMedia => ({
  id: row.id,
  contentType: row.contentType,
  width: row.width,
  height: row.height,
  byteSize: Number(row.byteSize),
  alt: row.alt,
  createdAt: iso(row.createdAt),
});

interface LegalRevisionRow {
  id: string;
  kind: string;
  locale: string;
  title: string;
  body: string;
  effectiveFrom: string;
  publishedAt: Date | string;
}

const toLegalRevision = (row: LegalRevisionRow): LegalDocumentRevision => ({
  id: row.id,
  kind: row.kind as LegalDocumentKind,
  locale: row.locale as UiLocale,
  title: row.title,
  body: row.body,
  effectiveFrom: row.effectiveFrom,
  publishedAt: iso(row.publishedAt),
});

interface LegalDraftRow {
  kind: string;
  locale: string;
  title: string;
  body: string;
  effectiveFrom: string;
  updatedAt: Date | string;
}

const toLegalDraft = (row: LegalDraftRow): LegalDocumentDraft => ({
  kind: row.kind as LegalDocumentKind,
  locale: row.locale as UiLocale,
  title: row.title,
  body: row.body,
  effectiveFrom: row.effectiveFrom,
  updatedAt: iso(row.updatedAt),
});

interface ArticleRow {
  id: string;
  slug: string;
  status: string;
  coverMediaId: string | null;
  publishedAt: Date | string | null;
  version: number;
}

/** The part of an article the rules of the service decide on. */
export interface ArticleState {
  id: string;
  slug: string;
  status: ArticleStatus;
  coverMediaId: string | null;
  publishedAt: string | null;
  version: number;
}

const toArticleState = (row: ArticleRow): ArticleState => ({
  id: row.id,
  slug: row.slug,
  status: row.status as ArticleStatus,
  coverMediaId: row.coverMediaId,
  publishedAt: row.publishedAt === null ? null : iso(row.publishedAt),
  version: row.version,
});

/** A translation counts for the readers only with a title and a text (the table cannot hold a removed translation). */
const READABLE = sql`t.title <> '' and t.body <> ''`;

// Everything but the bytes: lists and records never read the file (it is up to 2 MiB).
const MEDIA_COLUMNS = sql`m.id, m.content_type, m.width, m.height, octet_length(m.bytes) as byte_size, m.alt,
  m.created_at`;

// The site settings (one row, id = 1), the images and the tariffs shown to the public (ADR-0023, spec
// 2026-10-28-public-site-design, 6.2–6.3, 7.2). The tables are of the platform class: the platform transaction of the
// caller.
@Injectable()
export class SiteContentRepository {
  /** The settings as the site shows them: without the update time. */
  async publicSettings(
    trx: Transaction<DB>,
  ): Promise<UpdateSiteSettingsRequest> {
    return (await this.settingsRow(trx)).settings;
  }

  async settings(trx: Transaction<DB>): Promise<SiteSettings> {
    const { settings, updatedAt } = await this.settingsRow(trx);
    return { ...settings, updatedAt };
  }

  private async settingsRow(
    trx: Transaction<DB>,
  ): Promise<{ settings: UpdateSiteSettingsRequest; updatedAt: string }> {
    const row = await trx
      .selectFrom('siteSettings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return {
      settings: {
        name: siteText(row.name),
        tagline: siteText(row.tagline),
        seoDescription: siteText(row.seoDescription),
        address: siteText(row.address),
        workingHours: siteText(row.workingHours),
        logoMediaId: row.logoMediaId,
        faviconMediaId: row.faviconMediaId,
        ogImageMediaId: row.ogImageMediaId,
        phone: row.phone,
        email: row.email,
        telegramUrl: row.telegramUrl,
        whatsappUrl: row.whatsappUrl,
      },
      updatedAt: iso(row.updatedAt),
    };
  }

  async updateSettings(
    trx: Transaction<DB>,
    next: UpdateSiteSettingsRequest,
    operatorId: string,
  ): Promise<void> {
    await trx
      .updateTable('siteSettings')
      .set({
        name: textJson(next.name),
        tagline: textJson(next.tagline),
        seoDescription: textJson(next.seoDescription),
        address: textJson(next.address),
        workingHours: textJson(next.workingHours),
        logoMediaId: next.logoMediaId,
        faviconMediaId: next.faviconMediaId,
        ogImageMediaId: next.ogImageMediaId,
        phone: next.phone,
        email: next.email,
        telegramUrl: next.telegramUrl,
        whatsappUrl: next.whatsappUrl,
        updatedAt: sql`now()`,
        updatedBy: operatorId,
      })
      .where('id', '=', 1)
      .execute();
  }

  /** The ids of `ids` that are not in `site_media` (the ids are lower-case, as the database prints them). */
  async missingMedia(trx: Transaction<DB>, ids: string[]): Promise<string[]> {
    const found = await this.mediaTypes(trx, ids);
    return ids.filter((id) => !found.has(id));
  }

  /** The type of each of `ids` that is stored, by its lower-case id. */
  async mediaTypes(
    trx: Transaction<DB>,
    ids: string[],
  ): Promise<Map<string, SiteMediaType>> {
    if (ids.length === 0) return new Map();
    const rows = await trx
      .selectFrom('siteMedia')
      .select(['id', 'contentType'])
      .where('id', 'in', ids)
      .execute();
    return new Map(
      rows.map((row) => [row.id, row.contentType as SiteMediaType]),
    );
  }

  async mediaByHash(
    trx: Transaction<DB>,
    sha256: Buffer,
  ): Promise<SiteMedia | null> {
    const { rows } = await sql<MediaRow>`
      select ${MEDIA_COLUMNS} from pharmacy.site_media m where m.sha256 = ${sha256}`.execute(
      trx,
    );
    return rows.length === 0 ? null : toMedia(rows[0]);
  }

  /** `null` when the same file (by SHA-256) was stored meanwhile by another request. */
  async insertMedia(
    trx: Transaction<DB>,
    values: {
      id: string;
      contentType: SiteMediaType;
      bytes: Buffer;
      sha256: Buffer;
      width: number;
      height: number;
      alt: string;
      createdBy: string;
    },
  ): Promise<SiteMedia | null> {
    const { rows } = await sql<MediaRow>`
      insert into pharmacy.site_media as m
        (id, content_type, bytes, sha256, width, height, alt, created_by)
      values (${values.id}, ${values.contentType}, ${values.bytes}, ${values.sha256}, ${values.width},
              ${values.height}, ${values.alt}, ${values.createdBy})
      on conflict (sha256) do nothing
      returning ${MEDIA_COLUMNS}`.execute(trx);
    return rows.length === 0 ? null : toMedia(rows[0]);
  }

  async listMedia(
    trx: Transaction<DB>,
    limit: number,
    offset: number,
  ): Promise<{ items: SiteMedia[]; total: number }> {
    const { rows } = await sql<MediaRow>`
      select ${MEDIA_COLUMNS} from pharmacy.site_media m
      order by m.created_at desc, m.id desc
      limit ${limit} offset ${offset}`.execute(trx);
    const { rows: counted } = await sql<{ total: number | string }>`
      select count(*) as total from pharmacy.site_media`.execute(trx);
    return { items: rows.map(toMedia), total: Number(counted[0].total) };
  }

  /** The file itself: only the two content routes read the bytes. */
  async mediaContent(
    trx: Transaction<DB>,
    id: string,
  ): Promise<{ contentType: SiteMediaType; bytes: Buffer } | null> {
    const row = await trx
      .selectFrom('siteMedia')
      .select(['contentType', 'bytes'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined
      ? null
      : { contentType: row.contentType as SiteMediaType, bytes: row.bytes };
  }

  /** The tariffs: the price of a store and the VAT from the platform settings, the visible services. */
  async pricing(trx: Transaction<DB>): Promise<PublicSiteInfo['pricing']> {
    const settings = await trx
      .selectFrom('platformSettings')
      .select(['storeMonthlyPriceDirams', 'vatBp'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const services = await trx
      .selectFrom('services')
      .select(['id', 'name', 'description', 'basePriceDirams'])
      .where('visible', '=', true)
      .where('archived', '=', false)
      .orderBy('createdAt')
      .orderBy('id')
      .execute();
    return {
      storeMonthlyPriceDirams: Number(settings.storeMonthlyPriceDirams),
      vatBp: settings.vatBp,
      services: services.map((row): PublicService => ({
        id: row.id,
        // The services keep `tj`; the site speaks `tg` (UiLocale).
        name: { ru: textOf(row.name, 'ru'), tg: textOf(row.name, 'tj') },
        description: {
          ru: textOf(row.description, 'ru'),
          tg: textOf(row.description, 'tj'),
        },
        basePriceDirams: Number(row.basePriceDirams),
      })),
    };
  }

  // ── Legal documents ───────────────────────────────────────────────────────────────────

  async legalDrafts(trx: Transaction<DB>): Promise<LegalDocumentDraft[]> {
    const rows = await trx
      .selectFrom('legalDocumentDrafts')
      .selectAll()
      .orderBy('kind')
      .orderBy('locale')
      .execute();
    return rows.map(toLegalDraft);
  }

  /** `lock` takes the row lock that serializes the publications of one kind and language. */
  async legalDraft(
    trx: Transaction<DB>,
    kind: LegalDocumentKind,
    locale: UiLocale,
    lock = false,
  ): Promise<LegalDocumentDraft | null> {
    let query = trx
      .selectFrom('legalDocumentDrafts')
      .selectAll()
      .where('kind', '=', kind)
      .where('locale', '=', locale);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row === undefined ? null : toLegalDraft(row);
  }

  /** One draft per kind and language: the save replaces it. */
  async saveLegalDraft(
    trx: Transaction<DB>,
    kind: LegalDocumentKind,
    locale: UiLocale,
    values: { title: string; body: string; effectiveFrom: string },
    operatorId: string,
  ): Promise<LegalDocumentDraft> {
    const row = await trx
      .insertInto('legalDocumentDrafts')
      .values({ kind, locale, ...values, updatedBy: operatorId })
      .onConflict((oc) =>
        oc.columns(['kind', 'locale']).doUpdateSet({
          ...values,
          updatedAt: sql`now()`,
          updatedBy: operatorId,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toLegalDraft(row);
  }

  /** The published revisions without the text (the overview never reads the body), the newest first. */
  async legalRevisions(
    trx: Transaction<DB>,
  ): Promise<Omit<LegalDocumentRevision, 'body'>[]> {
    const rows = await trx
      .selectFrom('legalDocumentRevisions')
      .select(['id', 'kind', 'locale', 'title', 'effectiveFrom', 'publishedAt'])
      .orderBy('kind')
      .orderBy('locale')
      .orderBy('effectiveFrom', 'desc')
      .orderBy('publishedAt', 'desc')
      .execute();
    return rows.map(
      ({ id, kind, locale, title, effectiveFrom, publishedAt }) => ({
        id,
        kind: kind as LegalDocumentKind,
        locale: locale as UiLocale,
        title,
        effectiveFrom,
        publishedAt: iso(publishedAt),
      }),
    );
  }

  /** The revision of a kind and a language published last, in force or not; `null` before the first. */
  async latestLegalRevision(
    trx: Transaction<DB>,
    kind: LegalDocumentKind,
    locale: UiLocale,
  ): Promise<LegalDocumentRevision | null> {
    const row = await trx
      .selectFrom('legalDocumentRevisions')
      .selectAll()
      .where('kind', '=', kind)
      .where('locale', '=', locale)
      .orderBy('publishedAt', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row === undefined ? null : toLegalRevision(row);
  }

  async insertLegalRevision(
    trx: Transaction<DB>,
    values: {
      id: string;
      kind: LegalDocumentKind;
      locale: UiLocale;
      title: string;
      body: string;
      effectiveFrom: string;
      publishedBy: string;
    },
  ): Promise<LegalDocumentRevision> {
    const row = await trx
      .insertInto('legalDocumentRevisions')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toLegalRevision(row);
  }

  /**
   * The rule of the revision in force on `today` (Dushanbe date), the only one (spec 7.1–7.3): per kind and language
   * the latest by the date of entry into force, then by the time of the publication (then by id, so a consent always
   * points at the same row), among those whose date has come.
   */
  private currentRevisions(trx: Transaction<DB>, today: string) {
    return trx
      .selectFrom('legalDocumentRevisions')
      .distinctOn(['kind', 'locale'])
      .where('effectiveFrom', '<=', today)
      .orderBy('kind')
      .orderBy('locale')
      .orderBy('effectiveFrom', 'desc')
      .orderBy('publishedAt', 'desc')
      .orderBy('id', 'desc');
  }

  /** The revision in force of a kind and a language; `null` when there is none. */
  async currentLegalRevision(
    trx: Transaction<DB>,
    kind: LegalDocumentKind,
    locale: UiLocale,
    today: string,
  ): Promise<LegalDocumentRevision | null> {
    const row = await this.currentRevisions(trx, today)
      .selectAll()
      .where('kind', '=', kind)
      .where('locale', '=', locale)
      .executeTakeFirst();
    return row === undefined ? null : toLegalRevision(row);
  }

  /** The id only: the text of a revision is not needed to refer to it. */
  async currentLegalRevisionId(
    trx: Transaction<DB>,
    kind: LegalDocumentKind,
    locale: UiLocale,
    today: string,
  ): Promise<string | null> {
    const row = await this.currentRevisions(trx, today)
      .select('id')
      .where('kind', '=', kind)
      .where('locale', '=', locale)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  /**
   * The revision in force of every kind and language that has one. `updatedAt` — the later of its publication and the
   * start of its day of entry into force in Dushanbe (a revision published ahead changes the page on that day).
   */
  async currentLegalRevisions(
    trx: Transaction<DB>,
    today: string,
  ): Promise<
    { kind: LegalDocumentKind; locale: UiLocale; updatedAt: string }[]
  > {
    const rows = await this.currentRevisions(trx, today)
      .select([
        'kind',
        'locale',
        sql<Date>`greatest(published_at, effective_from::timestamp at time zone ${sql.lit(PLATFORM_TIME_ZONE)})`.as(
          'updatedAt',
        ),
      ])
      .execute();
    return rows.map((row) => ({
      kind: row.kind as LegalDocumentKind,
      locale: row.locale as UiLocale,
      updatedAt: iso(row.updatedAt),
    }));
  }

  // ── Articles ──────────────────────────────────────────────────────────────────────────

  /** The row a rule decides on; `lock` takes the row lock that serializes the status changes of one article. */
  async articleState(
    trx: Transaction<DB>,
    id: string,
    lock = false,
  ): Promise<ArticleState | null> {
    let query = trx
      .selectFrom('articles')
      .select([
        'id',
        'slug',
        'status',
        'coverMediaId',
        'publishedAt',
        'version',
      ])
      .where('id', '=', id);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row === undefined ? null : toArticleState(row);
  }

  async article(trx: Transaction<DB>, id: string): Promise<Article | null> {
    const row = await trx
      .selectFrom('articles')
      .select([
        'id',
        'slug',
        'status',
        'coverMediaId',
        'publishedAt',
        'version',
        'updatedAt',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) return null;
    const translations = await trx
      .selectFrom('articleTranslations')
      .selectAll()
      .where('articleId', '=', id)
      .execute();
    const byLocale: Article['translations'] = {};
    for (const t of translations)
      byLocale[t.locale as UiLocale] = {
        title: t.title,
        excerpt: t.excerpt,
        body: t.body,
        seoTitle: t.seoTitle,
        seoDescription: t.seoDescription,
      };
    return {
      id: row.id,
      slug: row.slug,
      status: row.status as ArticleStatus,
      coverMediaId: row.coverMediaId,
      publishedAt: row.publishedAt === null ? null : iso(row.publishedAt),
      updatedAt: iso(row.updatedAt),
      version: row.version,
      translations: byLocale,
    };
  }

  async insertArticle(
    trx: Transaction<DB>,
    values: {
      id: string;
      slug: string;
      coverMediaId: string | null;
      operatorId: string;
    },
  ): Promise<void> {
    await trx
      .insertInto('articles')
      .values({
        id: values.id,
        slug: values.slug,
        coverMediaId: values.coverMediaId,
        createdBy: values.operatorId,
        updatedBy: values.operatorId,
      })
      .execute();
  }

  /**
   * The edit, taken only while `version` is still the stored one: of two edits made on the same version the second
   * finds nothing to change and gets `false`. A success raises the version.
   */
  async updateArticleVersioned(
    trx: Transaction<DB>,
    id: string,
    version: number,
    values: { slug: string; coverMediaId: string | null },
    operatorId: string,
  ): Promise<boolean> {
    const result = await trx
      .updateTable('articles')
      .set({
        slug: values.slug,
        coverMediaId: values.coverMediaId,
        version: sql<number>`version + 1`,
        updatedAt: sql`now()`,
        updatedBy: operatorId,
      })
      .where('id', '=', id)
      .where('version', '=', version)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  /** The status change; `published_at` keeps the first date of the publication. The caller holds the row lock. */
  async setArticleStatus(
    trx: Transaction<DB>,
    id: string,
    status: ArticleStatus,
    operatorId: string,
  ): Promise<void> {
    await trx
      .updateTable('articles')
      .set({
        status,
        ...(status === 'published'
          ? { publishedAt: sql<Date>`coalesce(published_at, now())` }
          : {}),
        version: sql<number>`version + 1`,
        updatedAt: sql`now()`,
        updatedBy: operatorId,
      })
      .where('id', '=', id)
      .execute();
  }

  async upsertArticleTranslation(
    trx: Transaction<DB>,
    articleId: string,
    locale: UiLocale,
    t: ArticleTranslation,
  ): Promise<void> {
    await trx
      .insertInto('articleTranslations')
      .values({ articleId, locale, ...t })
      .onConflict((oc) => oc.columns(['articleId', 'locale']).doUpdateSet(t))
      .execute();
  }

  /**
   * The operator list, the latest changed first. Without `status` the archived ones are left out; `q` is a part of the
   * RU title. `locales` are the readable translations.
   */
  async listArticles(
    trx: Transaction<DB>,
    filter: { status?: ArticleStatus; q?: string },
    limit: number,
    offset: number,
  ): Promise<{ items: ArticleListItem[]; total: number }> {
    const byStatus =
      filter.status === undefined
        ? sql`a.status <> 'archived'`
        : sql`a.status = ${filter.status}`;
    const byTitle =
      filter.q === undefined || filter.q === ''
        ? sql`true`
        : sql`r.title ilike ${`%${escapeLike(filter.q)}%`}`;
    const { rows } = await sql<{
      id: string;
      slug: string;
      status: string;
      titleRu: string;
      locales: string[];
      publishedAt: Date | string | null;
      updatedAt: Date | string;
    }>`
      select a.id, a.slug, a.status, coalesce(r.title, '') as title_ru,
             coalesce((select array_agg(t.locale order by t.locale) from pharmacy.article_translations t
                       where t.article_id = a.id and ${READABLE}), '{}'::text[]) as locales,
             a.published_at, a.updated_at
      from pharmacy.articles a
      left join pharmacy.article_translations r on r.article_id = a.id and r.locale = 'ru'
      where ${byStatus} and ${byTitle}
      order by a.updated_at desc, a.id desc
      limit ${limit} offset ${offset}`.execute(trx);
    const { rows: counted } = await sql<{ total: number | string }>`
      select count(*) as total
      from pharmacy.articles a
      left join pharmacy.article_translations r on r.article_id = a.id and r.locale = 'ru'
      where ${byStatus} and ${byTitle}`.execute(trx);
    return {
      items: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        status: row.status as ArticleStatus,
        titleRu: row.titleRu,
        locales: row.locales as UiLocale[],
        publishedAt: row.publishedAt === null ? null : iso(row.publishedAt),
        updatedAt: iso(row.updatedAt),
      })),
      total: Number(counted[0].total),
    };
  }

  /** The published articles that have a readable translation in `locale`, the newest publication first. */
  async publicArticles(
    trx: Transaction<DB>,
    locale: UiLocale,
    limit: number,
    offset: number,
  ): Promise<{ items: PublicArticleListItem[]; total: number }> {
    const { rows } = await sql<{
      slug: string;
      title: string;
      excerpt: string;
      coverMediaId: string | null;
      publishedAt: Date | string;
    }>`
      select a.slug, t.title, t.excerpt, a.cover_media_id, a.published_at
      from pharmacy.articles a
      join pharmacy.article_translations t on t.article_id = a.id and t.locale = ${locale}
      where a.status = 'published' and ${READABLE}
      order by a.published_at desc, a.id desc
      limit ${limit} offset ${offset}`.execute(trx);
    const { rows: counted } = await sql<{ total: number | string }>`
      select count(*) as total
      from pharmacy.articles a
      join pharmacy.article_translations t on t.article_id = a.id and t.locale = ${locale}
      where a.status = 'published' and ${READABLE}`.execute(trx);
    return {
      items: rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        coverMediaId: row.coverMediaId,
        publishedAt: iso(row.publishedAt),
      })),
      total: Number(counted[0].total),
    };
  }

  /** A published article in `locale`; `null` when it is not published or has no readable text in the language. */
  async publicArticle(
    trx: Transaction<DB>,
    slug: string,
    locale: UiLocale,
  ): Promise<PublicArticle | null> {
    const { rows } = await sql<{
      slug: string;
      title: string;
      excerpt: string;
      body: string;
      seoTitle: string;
      seoDescription: string;
      coverMediaId: string | null;
      publishedAt: Date | string;
      updatedAt: Date | string;
      locales: string[];
    }>`
      select a.slug, t.title, t.excerpt, t.body, t.seo_title, t.seo_description, a.cover_media_id, a.published_at,
             a.updated_at,
             (select array_agg(l.locale order by l.locale) from pharmacy.article_translations l
              where l.article_id = a.id and l.title <> '' and l.body <> '') as locales
      from pharmacy.articles a
      join pharmacy.article_translations t on t.article_id = a.id and t.locale = ${locale}
      where a.slug = ${slug} and a.status = 'published' and ${READABLE}`.execute(
      trx,
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      coverMediaId: row.coverMediaId,
      publishedAt: iso(row.publishedAt),
      locale,
      body: row.body,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      updatedAt: iso(row.updatedAt),
      locales: row.locales as UiLocale[],
    };
  }

  /** The published articles with the languages they can be read in, for `sitemap.xml`; the newest first. */
  async sitemapArticles(
    trx: Transaction<DB>,
  ): Promise<{ slug: string; locales: UiLocale[]; updatedAt: string }[]> {
    const { rows } = await sql<{
      slug: string;
      updatedAt: Date | string;
      locales: string[];
    }>`
      select a.slug, a.updated_at, array_agg(t.locale order by t.locale) as locales
      from pharmacy.articles a
      join pharmacy.article_translations t on t.article_id = a.id
      where a.status = 'published' and ${READABLE}
      group by a.id
      order by a.published_at desc, a.id desc`.execute(trx);
    return rows.map((row) => ({
      slug: row.slug,
      locales: row.locales as UiLocale[],
      updatedAt: iso(row.updatedAt),
    }));
  }
}
