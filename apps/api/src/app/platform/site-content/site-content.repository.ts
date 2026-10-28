import { Injectable } from '@nestjs/common';
import type {
  LegalDocumentDraft,
  LegalDocumentKind,
  LegalDocumentRevision,
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
import type { DB } from '../../../core/database';

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

  /** The ids of `ids` that are not in `site_media`. */
  async missingMedia(trx: Transaction<DB>, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await trx
      .selectFrom('siteMedia')
      .select('id')
      .where('id', 'in', ids)
      .execute();
    const found = new Set(rows.map((row) => row.id));
    return ids.filter((id) => !found.has(id));
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

  async legalDraft(
    trx: Transaction<DB>,
    kind: LegalDocumentKind,
    locale: UiLocale,
  ): Promise<LegalDocumentDraft | null> {
    const row = await trx
      .selectFrom('legalDocumentDrafts')
      .selectAll()
      .where('kind', '=', kind)
      .where('locale', '=', locale)
      .executeTakeFirst();
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
   * The revision in force on `today` (Dushanbe date): the latest by the date of entry into force, then by the time of
   * the publication, among those whose date has come. `null` when there is none.
   */
  async currentLegalRevision(
    trx: Transaction<DB>,
    kind: LegalDocumentKind,
    locale: UiLocale,
    today: string,
  ): Promise<LegalDocumentRevision | null> {
    const row = await trx
      .selectFrom('legalDocumentRevisions')
      .selectAll()
      .where('kind', '=', kind)
      .where('locale', '=', locale)
      .where('effectiveFrom', '<=', today)
      .orderBy('effectiveFrom', 'desc')
      .orderBy('publishedAt', 'desc')
      .limit(1)
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
    const row = await trx
      .selectFrom('legalDocumentRevisions')
      .select('id')
      .where('kind', '=', kind)
      .where('locale', '=', locale)
      .where('effectiveFrom', '<=', today)
      .orderBy('effectiveFrom', 'desc')
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.id ?? null;
  }
}
