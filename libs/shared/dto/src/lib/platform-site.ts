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
 * `validation_failed`; 404 `site_media_not_found` (a media id that does not exist).
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
 * 400 `validation_failed`; 413 `payload_too_large`; 415 `unsupported_media_type` (the signature does
 * not match one of `SiteMediaType`).
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

/** GET /operator/articles/{id} (`content:manage`). RU is required for publication. */
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

/** GET /operator/articles?status&limit&offset (`content:manage`) → `Page<ArticleListItem>`. */
export interface ArticleListItem {
  id: string;
  slug: string;
  status: ArticleStatus;
  titleRu: string;
  /** The languages the article has a translation in. */
  locales: UiLocale[];
  publishedAt: string | null;
  updatedAt: string;
}

/**
 * POST /operator/articles (no `version`, 201 `Article`) and PUT /operator/articles/{id} (with
 * `version`) (`content:manage`). Errors: 400 `validation_failed`; 404 `article_not_found`,
 * `site_media_not_found`; 409 `slug_taken`, `version_conflict` (someone saved after the version
 * given). Publication (POST .../publish) also answers 409 `ru_translation_required`; archiving
 * (POST .../archive) 409 `only_draft_can_be_archived`.
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
 * POST .../publish → `LegalDocumentRevision`. Errors: 400 `validation_failed`; 404
 * `legal_draft_not_found` (publish without a draft).
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
 * GET /public/legal-documents/{kind}?locale → `LegalDocumentRevision` (the current one). Errors: 404
 * `legal_document_not_found`.
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
