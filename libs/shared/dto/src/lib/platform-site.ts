/*
 * REST contract of the public site (ADR-0023, spec 2026-10-28-public-site-design): the public
 * contour `/api/v1/public/*` (no session) and the operator screens of the «Сайт» block of the admin.
 * Shapes only: apps/api implements them as class-validator DTO classes; frontends use `import type`
 * (ADR-0015). Dates: `YYYY-MM-DD` (date-only) or ISO instants (`...At`). Money: integer dirams
 * (*Dirams), TJS only (ADR-0016). Text of articles and documents is restricted Markdown (spec 6.6).
 */

import type { UiLocale } from './tenant-auth.js';

/** A text in both languages; an empty string means «not set». */
export type SiteText = { ru: string; tg: string };

// ── Site settings ─────────────────────────────────────────────────────────────────────────

/**
 * GET /operator/site-settings (`content:manage`). Media ids refer to `site_media`; `null` — not set.
 * An empty optional field is not shown on the site.
 */
export interface SiteSettings {
  name: SiteText;
  tagline: SiteText;
  seoDescription: SiteText;
  address: SiteText;
  workingHours: SiteText;
  logoMediaId: string | null;
  faviconMediaId: string | null;
  ogImageMediaId: string | null;
  phone: string;
  email: string;
  telegramUrl: string;
  whatsappUrl: string;
  updatedAt: string;
}

/**
 * PUT /operator/site-settings (`content:manage`, fresh operator sign-in) → `SiteSettings`. Errors: 400
 * `validation_failed`; 400 `media_not_found` (a media id that is not stored); 403 `fresh_auth_required`.
 */
export type UpdateSiteSettingsRequest = Omit<SiteSettings, 'updatedAt'>;

/** A one-time service of the platform shown on the tariffs page (visible, not archived). */
export interface PublicService {
  id: string;
  name: SiteText;
  description: SiteText;
  basePriceDirams: number;
}

/**
 * GET /public/site-info: the settings of the site and the tariffs from the platform settings. `vatBp`
 * — VAT in basis points; the price of a store is per month, VAT on top (billing spec 2026-10-15).
 */
export interface PublicSiteInfo {
  settings: UpdateSiteSettingsRequest;
  pricing: {
    storeMonthlyPriceDirams: number;
    vatBp: number;
    services: PublicService[];
  };
}

// ── Media ─────────────────────────────────────────────────────────────────────────────────

/** SVG is not allowed; the type is checked by the file signature, not by the extension. */
export type SiteMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** GET /operator/site-media (`content:manage`); the file itself — GET /operator/site-media/{id}/content. */
export interface SiteMedia {
  id: string;
  contentType: SiteMediaType;
  width: number;
  height: number;
  byteSize: number;
  alt: string;
  createdAt: string;
}

/**
 * POST /operator/site-media (`content:manage`) → 201 `SiteMedia`: JSON with the file in base64 (no
 * multipart in the API), up to 2 MiB of the file; the same file twice returns the stored one. Errors:
 * 400 `validation_failed` (also a `dataBase64` that is not base64); 400 `unsupported_media_type` (the
 * signature does not match the declared `SiteMediaType`, or a side is over 20 000 pixels); 413
 * `media_too_large` (the file is over 2 MiB), 413 `payload_too_large` (the body is over 3 MiB).
 * GET /operator/site-media/{id}/content and GET /public/media/{id} answer 404 `media_not_found`.
 */
export interface UploadSiteMediaRequest {
  contentType: SiteMediaType;
  dataBase64: string;
  alt: string;
}

// ── Articles ──────────────────────────────────────────────────────────────────────────────

/** `archived` — only a draft can be archived (rows are never deleted). */
export type ArticleStatus = 'draft' | 'published' | 'unpublished' | 'archived';

export interface ArticleTranslation {
  /** 3–150 characters. */
  title: string;
  /** Up to 300. */
  excerpt: string;
  /** Restricted Markdown, up to 100 000. */
  body: string;
  /** Up to 70. */
  seoTitle: string;
  /** Up to 160. */
  seoDescription: string;
}

/**
 * GET /operator/articles/{id} (`content:manage`). RU with a title and a text is required for publication. A saved
 * translation cannot be removed (rows are never deleted): the readers (the public list, the page, `locales`, the
 * sitemap) treat a translation with an empty `title` or `body` as absent. The table needs a title of 3+ characters,
 * so the operator hides a language by emptying its `body`.
 */
export interface Article {
  id: string;
  slug: string;
  status: ArticleStatus;
  coverMediaId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  /** The optimistic lock: send it back in `SaveArticleRequest.version`. */
  version: number;
  translations: Partial<Record<UiLocale, ArticleTranslation>>;
}

/**
 * GET /operator/articles?status&q&limit&offset (`content:manage`) → `Page<ArticleListItem>`, the latest changed first
 * (20 by default, 100 at most). Without `status` the archived ones are left out; `q` is a part of the RU title.
 */
export interface ArticleListItem {
  id: string;
  slug: string;
  status: ArticleStatus;
  titleRu: string;
  /** The languages with a readable translation (a title and a text). `titleRu` is empty without an RU translation. */
  locales: UiLocale[];
  publishedAt: string | null;
  updatedAt: string;
}

/**
 * POST /operator/articles (no `version`, 201 `Article` of version 1) and PUT /operator/articles/{id} (with
 * `version`, 200) (`content:manage`). A language is saved as a whole; a language absent from the request (or with all
 * five fields empty) stays as it was; a given language needs a title of 3–150 characters. Errors: 400
 * `validation_failed` (also PUT without `version`), 400 `media_not_found` (the cover or a `media:<id>` picture of a
 * text is not stored); 404 `article_not_found`; 409 `slug_taken`, `version_conflict` (someone saved after the version
 * given), `slug_locked` (the slug of an article that was ever published does not change), `archived` (an archived
 * article accepts no change).
 *
 * Every save and every status change raises `version`. Status changes (200 `Article`, no body):
 * POST /operator/articles/{id}/publish (draft or unpublished → published; `publishedAt` keeps the first date) —
 * 400 `translation_required` (no RU with a title and a text), 409 `already_published`, `archived`;
 * POST .../unpublish (published → unpublished) — 409 `not_published`, `archived`;
 * POST .../archive (draft → archived) — 409 `not_draft`, `archived`. All of them 404 `article_not_found`.
 */
export interface SaveArticleRequest {
  slug: string;
  coverMediaId: string | null;
  translations: Partial<Record<UiLocale, ArticleTranslation>>;
  version?: number;
}

/** GET /public/articles?locale&limit&offset → `Page<PublicArticleListItem>`; published only. */
export interface PublicArticleListItem {
  slug: string;
  title: string;
  excerpt: string;
  coverMediaId: string | null;
  publishedAt: string;
}

/**
 * GET /public/articles/{slug}?locale. `locale` — the language of the text; `locales` — all the languages
 * the article exists in (for hreflang). Errors: 404 `article_not_found` (not published, or no version
 * in this language).
 */
export interface PublicArticle extends PublicArticleListItem {
  locale: UiLocale;
  body: string;
  seoTitle: string;
  seoDescription: string;
  updatedAt: string;
  locales: UiLocale[];
}

// ── Legal documents ───────────────────────────────────────────────────────────────────────

export type LegalDocumentKind = 'offer' | 'privacy';

/** A published revision: append-only, never changed or deleted (connection requests refer to it). */
export interface LegalDocumentRevision {
  id: string;
  kind: LegalDocumentKind;
  locale: UiLocale;
  title: string;
  body: string;
  /** YYYY-MM-DD; the current revision is the last published one with `effectiveFrom <= today`. */
  effectiveFrom: string;
  publishedAt: string;
}

/** The draft of the next revision — one per `kind` and `locale`. */
export interface LegalDocumentDraft {
  kind: LegalDocumentKind;
  locale: UiLocale;
  title: string;
  body: string;
  effectiveFrom: string;
  updatedAt: string;
}

/**
 * PUT /operator/legal-documents/{kind}/{locale}/draft (`content:manage`) → `LegalDocumentDraft`; then
 * POST .../publish → 201 `LegalDocumentRevision` (the draft stays). Errors: 400 `validation_failed` (on
 * publication: `effectiveFrom` earlier than today in Asia/Dushanbe); 400 `media_not_found` (a picture of
 * the text is not stored); 404 `not_found` (a `kind` or `locale` that does not exist); 409 `draft_empty`
 * (publish without a draft).
 */
export interface SaveLegalDocumentDraftRequest {
  title: string;
  body: string;
  effectiveFrom: string;
}

/** GET /operator/legal-documents (`content:manage`): the drafts and the published revisions without the text. */
export interface LegalDocumentsOverview {
  drafts: LegalDocumentDraft[];
  revisions: Omit<LegalDocumentRevision, 'body'>[];
}

/**
 * GET /public/legal-documents/{kind}?locale → `LegalDocumentRevision` (the current one of the language,
 * else of RU). Errors: 400 `validation_failed` (a `locale` other than `ru` and `tg`); 404 `not_found`
 * (an unknown `kind`, or nothing is published).
 *
 * GET /public/sitemap: slugs and dates of the published articles and documents by language (for
 * `sitemap.xml`).
 */
export interface PublicSitemap {
  articles: { slug: string; locales: UiLocale[]; updatedAt: string }[];
  legal: { kind: LegalDocumentKind; locales: UiLocale[]; updatedAt: string }[];
}

// ── Connection requests ───────────────────────────────────────────────────────────────────

export type ConnectionRequestStatus =
  | 'new'
  | 'in_progress'
  | 'connected'
  | 'rejected'
  | 'spam';

/**
 * POST /public/connection-requests → 201 without a body (the same answer for a trap hit, a form
 * filled too fast and a duplicate: the bot is not told). `consent` — the policy of the personal data
 * is accepted. `website` — the hidden trap field, must be empty. `openedAt` — the ISO instant the form
 * was opened. Errors: 400 `validation_failed`; 409 `privacy_not_published` (no published policy);
 * 429 `too_many_requests` (3 per hour from an IP; 200 per day in all).
 */
export interface SubmitConnectionRequest {
  networkName: string;
  city: string;
  /** 1–500. */
  storeCount: number;
  contactName: string;
  /** Normalized to E.164 by the server. */
  phone: string;
  email?: string;
  /** 9 digits. */
  inn?: string;
  callTime?: string;
  /** Up to 500 characters. */
  comment?: string;
  locale: UiLocale;
  consent: true;
  website?: string;
  openedAt: string;
}

/**
 * GET /operator/connection-requests/{id} (`tenants:view`). The personal data is `null` after the
 * anonymization (`anonymizedAt`): 180 days after the decision for `rejected` and `spam`. Errors: 404
 * `connection_request_not_found`.
 */
export interface ConnectionRequest {
  id: string;
  status: ConnectionRequestStatus;
  networkName: string;
  city: string;
  storeCount: number;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  inn: string | null;
  callTime: string | null;
  comment: string | null;
  locale: UiLocale;
  /** The revision of the privacy policy the visitor consented to. */
  privacyDocumentId: string;
  createdAt: string;
  assignedTo: { id: string; fullName: string } | null;
  operatorNote: string | null;
  rejectReason: string | null;
  /** The network created from the request. */
  tenantId: string | null;
  decidedAt: string | null;
  anonymizedAt: string | null;
  /** Networks with the same INN or the owner's phone — a warning in the card. */
  similarTenants: { id: string; name: string }[];
}

/**
 * GET /operator/connection-requests?status&q&limit&offset (`tenants:view`) → `Page<ConnectionRequestListItem>`;
 * `q` — by the name of the network and the phone.
 */
export type ConnectionRequestListItem = Omit<
  ConnectionRequest,
  'comment' | 'operatorNote' | 'similarTenants'
>;

/**
 * POST /operator/connection-requests/{id}/reject (`tenants:manage`) → `ConnectionRequest`; `reason` is
 * 5–500 characters. Errors: 400 `validation_failed`; 404 `connection_request_not_found`; 409
 * `request_already_decided`. `take` and `mark-spam` answer the same.
 */
export interface RejectConnectionRequestRequest {
  reason: string;
}

/** PUT /operator/connection-requests/{id}/note (`tenants:manage`) → `ConnectionRequest`; up to 1000 characters. */
export interface ConnectionRequestNoteRequest {
  note: string;
}
