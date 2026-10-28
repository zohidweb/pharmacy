# Публичный сайт, часть 1 — ADR-0023 и API: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API отдаёт публичному сайту настройки, тарифы, статьи, документы и картинки через `/api/v1/public/*`,
принимает заявки на подключение и даёт оператору управлять всем этим через `/api/v1/operator/*`.

**Architecture:** два новых модуля платформы (`app/platform/site-content`, `app/platform/connection-requests`) на
роли `pharmacy_platform`, таблицы класса `platform` без DELETE. Публичный контур — `@Public()` с проверкой `Origin`
по `SITE_ORIGIN`. Текст статей — ограниченный Markdown, свой парсер в `libs/shared/util` (сайт и админка рисуют его
дерево; API хранит исходник и проверяет его разбором при сохранении).

**Tech Stack:** NestJS, Kysely (`sql` через `PlatformDatabase.platformTransaction`), PostgreSQL, class-validator,
`@nestjs/throttler` (Redis), `node:crypto` (SHA-256 картинок).

**Spec:** `docs/superpowers/specs/2026-10-28-public-site-design.md`; ADR-0023 `docs/architecture/adr/0023-publichnyj-sajt.md`
(сейчас `proposed`; утверждение плана — его принятие).

**Следующие планы:** часть 2 — блок «Сайт» в админке; часть 3 — `apps/site`, образ, Caddy, `stack.mjs`. Пишутся после
слияния этой части: они ссылаются на её DTO.

## Global Constraints

- **Тесты отложены до MVP** (решение пользователя 2026-10-05): новых тестов нет, существующие наборы — зелёные, в том
  числе `catalog.int-spec.ts` (классы таблиц) и `messages.spec.ts`. Непокрытое — в разделе «Долг тестов».
- Полные `npm run check`, `api:integration`, `api-e2e` запускает пользователь; исполнитель — только точечные
  `npx nx lint api`, `npx nx test api --testPathPattern=<файл>`, `npx nx typecheck api`.
- Миграции dev-БД (`npx nx run api:migrate`) и перегенерацию типов (`npx nx run api:db-types`) запускает пользователь
  по просьбе исполнителя; исполнитель в это время ждёт.
- Деньги — integer в дирамах. Языки сайта — `UiLocale` (`'ru' | 'tg'`, `libs/shared/dto/src/lib/tenant-auth.ts`);
  у `services` в JSON ключ `tj` — API переводит его в `tg`.
- Новые таблицы — класс `platform`: RLS `enable` + `force`, политика `platform_all … to pharmacy_platform using (true)
  with check (true)`, `grant select, insert, update … to pharmacy_platform`; DELETE и доступа `pharmacy_app` нет.
- Аудит — `PlatformAuditService.append(trx, { action, entityType, entityId })`, действия `entity.past-participle`;
  ПДн заявки в `details` не пишутся.
- Ошибки — `ProblemException(status, code)` / `FieldProblemException(400, 'validation_failed', [...])`.
- Пределы: картинка ≤ 2 МиБ (2 097 152 байт), JSON тела загрузки картинки ≤ 3 МиБ; статья `body` ≤ 100 000 символов;
  заявок с IP — 3 в час; всего новых заявок (не спам) — 200 за 24 ч; публичные GET — 1200 в минуту с IP; обезличивание
  — через 180 дней; время заполнения формы < 3 с — спам; дубль телефона — 24 ч.

## Решения автора (утверждение плана — принятие ADR-0023)

Решения P1–P16 спецификации (раздел 11) плюс:

| № | Решение |
|---|---|
| A1 | Публичные контроллеры живут в своих модулях (`public-*.controller.ts`), путь `public/...`; `isPublicPath` — префикс `/api/v1/public` |
| A2 | Поле-ловушка формы называется `website`; время открытия формы — `openedAt` (ISO), его подделка лишь пропускает заявку в обычную очередь |
| A3 | Картинки-дубли: тот же SHA-256 — возвращается существующая запись (201 с прежним `id`) |
| A4 | Похожая сеть в заявке — совпадение ИНН сети или нормализованного телефона владельца (`employees` через резолвер не нужен: `tenants.inn` и телефон владельца читает `platform/tenants`, порт `TenantLookup`) |
| A5 | `GET public/site-info` отдаёт настройки и тарифы одним ответом; сайт кеширует его на 60 с |
| A6 | Статья публикуется только с RU-переводом и непустыми `title`, `body`; slug неизменяем после первой публикации (иначе ломаются ссылки из поиска) |

## Review Focus

1. **Ссылка `javascript:` или HTML в статье** — парсер оставляет текстом, ссылка не создаётся (Task 3, шаг проверки
   в `node -e`).
2. **Заявка с другого сайта** (чужой `Origin`) — 403 от `CsrfGuard`; с `SITE_ORIGIN` — 201 (Task 4, проверка `curl`).
3. **Картинка с расширением `.png`, а внутри HTML/SVG** — 400 `unsupported_media_type` по сигнатуре (Task 5, `curl`).
4. **Повторная отправка формы** (двойной клик, бот с тем же телефоном) — одна строка, оба ответа 201 (Task 8, `curl`
   дважды и `select count(*)`).
5. **Черновик или снятая статья по прямому адресу** — `GET public/articles/{slug}` → 404 (Task 7, `curl`).

---

### Task 1: ADR-0023 и общие контракты

**Files:**
- Create: `docs/architecture/adr/0023-publichnyj-sajt.md` (уже написан, `proposed`)
- Modify: `docs/architecture/APPROVAL.md` (строка при принятии)
- Modify: `libs/shared/domain/src/lib/operator-permissions.ts`
- Create: `libs/shared/dto/src/lib/platform-site.ts`; Modify: `libs/shared/dto/src/index.ts`
- Modify: `libs/shared/dto/src/lib/platform-system.ts` (`AttentionCounts`, `EventKind`, `NotificationTopic`)
- Modify: `libs/shared/dto/src/lib/platform-tenants.ts` (`CreateTenantRequest`)

**Interfaces:**
- Produces (в `platform-site.ts`, все — `interface`/`type`, как в соседних файлах):
  - `type SiteText = { ru: string; tg: string }` — пустая строка = не задано.
  - `SiteSettings { name, tagline, seoDescription, address, workingHours: SiteText; logoMediaId, faviconMediaId,
    ogImageMediaId: string | null; phone, email, telegramUrl, whatsappUrl: string; updatedAt: string }`;
    `UpdateSiteSettingsRequest = Omit<SiteSettings, 'updatedAt'>`.
  - `PublicService { id: string; name: SiteText; description: SiteText; basePriceDirams: number }`;
    `PublicSiteInfo { settings: UpdateSiteSettingsRequest; pricing: { storeMonthlyPriceDirams: number; vatBp: number;
    services: PublicService[] } }`.
  - `SiteMedia { id; contentType: SiteMediaType; width: number; height: number; byteSize: number; alt: string;
    createdAt }`, `type SiteMediaType = 'image/jpeg' | 'image/png' | 'image/webp'`,
    `UploadSiteMediaRequest { contentType: SiteMediaType; dataBase64: string; alt: string }`.
  - `type ArticleStatus = 'draft' | 'published' | 'unpublished' | 'archived'`;
    `ArticleTranslation { title; excerpt; body; seoTitle; seoDescription: string }`;
    `Article { id; slug; status; coverMediaId: string | null; publishedAt: string | null; updatedAt; version: number;
    translations: Partial<Record<UiLocale, ArticleTranslation>> }`;
    `ArticleListItem { id; slug; status; titleRu: string; locales: UiLocale[]; publishedAt; updatedAt }`;
    `SaveArticleRequest { slug; coverMediaId: string | null; translations: Partial<Record<UiLocale, ArticleTranslation>>;
    version?: number }` (без `version` — создание).
  - `PublicArticleListItem { slug; title; excerpt; coverMediaId: string | null; publishedAt: string }`;
    `PublicArticle extends PublicArticleListItem { locale: UiLocale; body; seoTitle; seoDescription; updatedAt;
    locales: UiLocale[] }`; `PublicSitemap { articles: { slug; locales: UiLocale[]; updatedAt }[];
    legal: { kind: LegalDocumentKind; locales: UiLocale[]; updatedAt }[] }`.
  - `type LegalDocumentKind = 'offer' | 'privacy'`; `LegalDocumentRevision { id; kind; locale: UiLocale; title; body;
    effectiveFrom: string /* YYYY-MM-DD */; publishedAt }`; `LegalDocumentDraft { kind; locale; title; body;
    effectiveFrom; updatedAt }`; `SaveLegalDocumentDraftRequest { title; body; effectiveFrom }`;
    `LegalDocumentsOverview { drafts: LegalDocumentDraft[]; revisions: Omit<LegalDocumentRevision, 'body'>[] }`.
  - `type ConnectionRequestStatus = 'new' | 'in_progress' | 'connected' | 'rejected' | 'spam'`;
    `SubmitConnectionRequest { networkName; city; storeCount: number; contactName; phone; email?; inn?; callTime?;
    comment?; locale: UiLocale; consent: true; website?: string; openedAt: string }`;
    `ConnectionRequest { id; status; networkName; city; storeCount; contactName, phone, email, inn, callTime, comment:
    string | null; locale; privacyDocumentId: string; createdAt; assignedTo: { id; fullName } | null; operatorNote:
    string | null; rejectReason: string | null; tenantId: string | null; decidedAt: string | null; anonymizedAt: string |
    null; similarTenants: { id; name }[] }`; `ConnectionRequestListItem` — без `comment`, `operatorNote`,
    `similarTenants`; `RejectConnectionRequestRequest { reason }`; `ConnectionRequestNoteRequest { note }`.
- Produces: `'content:manage'` в `OPERATOR_PERMISSIONS`; `AttentionCounts.connectionRequests: number`;
  `EventKind` + `'connection_requested'`; `NotificationTopic` + `'leads'`; `CreateTenantRequest.connectionRequestId?:
  string`.

- [ ] **Step 1:** Проверить, что ADR-0023 соответствует спецификации после поправок (картинки JSON, без DELETE); при
  принятии — статус `accepted (дата, архитектор проекта — APPROVAL.md)` и строка в `APPROVAL.md` по образцу ADR-0022.
- [ ] **Step 2:** Добавить контракты из блока Interfaces; комментарии JSDoc — коды ошибок маршрута, как у
  `CreateTenantRequest`.
- [ ] **Step 3:** `npx nx run-many -t typecheck -p shared-dto shared-domain` — без ошибок; `npx nx typecheck api admin`
  покажет места, где `AttentionCounts` и `NotificationTopic` перечисляются полностью, — заполнить их нулём/ключом
  (`preferencesOf` в `platform/notifications/notifications.service.ts`, моки админки).
- [ ] **Step 4:** Commit `docs: ADR-0023 public site; feat(shared): contracts of the public site`.

### Task 2: Миграция и классы таблиц

**Files:**
- Create: `apps/api/migrations/<timestamp>_public-site.sql`
- Modify: `apps/api/src/core/database/table-classes.ts`
- Modify: `apps/api/src/core/database/db.d.ts` (генерируется `api:db-types`)

**Interfaces:**
- Produces таблицы (схема `pharmacy`, все — класс `platform`, гранты и RLS из Global Constraints):
  - `site_settings` (`id smallint primary key check (id = 1)`, поля `SiteSettings`: `name`, `tagline`, `seo_description`,
    `address`, `working_hours` — `jsonb not null default '{"ru":"","tg":""}'` с `check (jsonb_typeof(x) = 'object')`;
    `phone`, `email`, `telegram_url`, `whatsapp_url` — `text not null default ''`; `*_media_id uuid references
    site_media`; `updated_at`, `updated_by references operators`); одна строка вставляется миграцией.
  - `site_media` (`id uuid pk`, `content_type check in (...)`, `bytes bytea not null check (octet_length(bytes) between 1
    and 2097152)`, `sha256 bytea not null unique`, `width int`, `height int` (1–20000), `alt text not null default ''`
    (≤ 200), `created_by`, `created_at`).
  - `articles` (`slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120)`,
    `status check in (...)`, `cover_media_id`, `published_at`, `version int not null default 1`, `created_*`,
    `updated_*`); `article_translations` (`primary key (article_id, locale)`, `locale check in ('ru','tg')`, длины —
    спецификация 7.1).
  - `legal_document_revisions` (append-only: в `APPEND_ONLY_TABLES`, грант только `select, insert`;
    `kind check in ('offer','privacy')`, `locale`, `title` 3–200, `body` 1–200 000, `effective_from date`,
    `published_at`, `published_by`; индекс `(kind, locale, effective_from desc, published_at desc)`);
    `legal_document_drafts` (`primary key (kind, locale)`).
  - `connection_requests` (поля `ConnectionRequest`; `client_ip inet`; `anonymized_at`; `check` длин: название и город
    1–120, ФИО 2–120, телефон E.164 `^\+[0-9]{8,15}$`, ИНН `^[0-9]{9}$`, `store_count` 1–500, `call_time` ≤ 100,
    `comment` ≤ 500, заметка ≤ 1000, причина 5–500; `check (status <> 'connected' or tenant_id is not null)`; индексы
    `(status, created_at)`, `(phone, created_at)`, `(created_at)`).
  - `platform_notifications.kind` + `'connection_requested'` (drop/add constraint, как в
    `1792744644428_login-locked-notification.sql`); `operators.muted_notification_topics` + `'leads'`.

- [ ] **Step 1:** Написать миграцию: `-- Up Migration`, `set local lock_timeout = '5s';`, таблицы, RLS, гранты.
- [ ] **Step 2:** Классы в `TABLE_CLASSES`, `legal_document_revisions` — в `APPEND_ONLY_TABLES`.
- [ ] **Step 3:** Попросить пользователя: `npx nx run api:migrate`, затем `npx nx run api:db-types` и
  `npx nx run api:integration -- --testPathPattern=catalog` — ожидается PASS (каждая таблица классифицирована, RLS
  принудителен, нет DELETE).
- [ ] **Step 4:** Commit `feat(api): tables of the public site`.

### Task 3: Парсер ограниченного Markdown

**Files:**
- Create: `libs/shared/util/src/lib/site-markdown.ts`; Modify: `libs/shared/util/src/index.ts`

**Interfaces:**
- Produces:
  - `type SiteInline = { kind: 'text'; text: string; bold?: true; italic?: true } | { kind: 'link'; href: string;
    children: SiteInline[] }`.
  - `type SiteBlock = { kind: 'heading'; level: 2 | 3; children: SiteInline[] } | { kind: 'paragraph'; children } |
    { kind: 'list'; ordered: boolean; items: SiteInline[][] } | { kind: 'quote'; children } | { kind: 'table'; header:
    SiteInline[][]; rows: SiteInline[][][] } | { kind: 'image'; mediaId: string; caption: string }`.
  - `parseSiteMarkdown(source: string): SiteBlock[]` — никогда не бросает.
  - `isSafeHref(href: string): boolean` — `https:`, `http:`, `mailto:`, путь от корня `/…` (не `//`).
  - `siteMarkdownMediaIds(blocks: SiteBlock[]): string[]` — для проверки, что картинки существуют.

- [ ] **Step 1:** Реализовать построчный разбор блоков (пустая строка разделяет абзацы; `## `, `### `, `- `/`* `,
  `1. `, `> `, таблица — строка `|…|` и разделитель `|---|`; картинка — строка целиком `![подпись](media:<uuid>)`) и
  разбор строчных `**…**`, `*…*`, `[текст](href)`. Ссылка с `!isSafeHref` — остаётся текстом целиком. Всё прочее,
  включая `<…>`, — текст. Глубина вложенности строчных — без рекурсии глубже 1 уровня (жирный/курсив внутри ссылки).
- [ ] **Step 2:** Проверка: `npx nx typecheck shared-util`; затем `node -e` по собранному `libs/shared/util/dist`
  (после `npx nx build shared-util`) на строках `[x](javascript:alert(1))`, `<script>alert(1)</script>`,
  `[x](//evil.com)`, `![a](media:not-a-uuid)` — ни один не даёт `link`/`image`; `## A **b** [c](https://d.tj)` —
  заголовок 2 с жирным и ссылкой.
- [ ] **Step 3:** Commit `feat(shared): restricted Markdown parser of the site`.

### Task 4: Публичный контур — CSRF, origin, тела, кеш

**Files:**
- Modify: `apps/api/src/common/http/contour.ts`, `apps/api/src/common/guards/csrf.guard.ts`
- Modify: `apps/api/src/app/config/env.validation.ts`, `apps/api/src/main.ts`
- Modify: `apps/api/src/core/crypto/session-token.service.ts`
- Modify: `.env.example`, `docker/env/test.env.example`, `docker/env/prod.env.example`, `docker/compose.yml` (переменная
  сервиса `api`)

**Interfaces:**
- Produces: `isPublicPath(originalUrl): boolean` (префикс `/api/v1/public`, та же нормализация, что `isSyncPath`);
  `isSiteMediaUploadPath(originalUrl): boolean` (`POST` пути `/api/v1/operator/site-media` ровно);
  `SessionTokenService.verifyOperatorNow(token: string): VerifiedOperatorClaims | null` (синхронная пара
  `verifyOperator`, как `verifyNow`); env `SITE_ORIGIN` (`@Matches(ORIGIN)`, обязательна; в `prod`+`cloud` —
  `https://`).
- Produces: `PUBLIC_READ_LIMIT = { limit: 1200, ttl: 60_000 }`, `CONNECTION_REQUEST_LIMIT = { limit: 3, ttl: 3_600_000 }`
  в `apps/api/src/common/throttling/public-limits.ts`.

- [ ] **Step 1:** `CsrfGuard`: для `isPublicPath` разрешённый `Origin` — `SITE_ORIGIN`; остальные правила (Sec-Fetch-Site,
  `application/json`) без изменений.
- [ ] **Step 2:** `main.ts`: `Cache-Control: no-store` не ставится для `GET` по `/api/v1/public/media/` (заголовок
  ставит контроллер); отдельный JSON-парсер `limit: 3 * 1024 * 1024` для `isSiteMediaUploadPath` с действующим токеном
  оператора (`verifyOperatorNow`), до общего парсера, — по образцу парсера загрузок.
- [ ] **Step 3:** `SITE_ORIGIN` во всех примерах env и в compose; в dev — `http://127.0.0.1:4400`.
- [ ] **Step 4:** Проверка: `npx nx typecheck api`, `npx nx test api --testPathPattern=csrf` и `env.validation` — PASS
  (существующие тесты; падение = регрессия). Commit `feat(api): public contour — origin, body and cache rules`.

### Task 5: Настройки сайта и картинки

**Files:**
- Create: `apps/api/src/app/platform/site-content/` — `site-content.module.ts`, `site-settings.controller.ts`,
  `site-settings.service.ts`, `site-media.controller.ts`, `site-media.service.ts`, `site-content.repository.ts`,
  `public-site.controller.ts`, `media-signature.ts`, `dto/site-settings.dto.ts`, `dto/site-media.dto.ts`
- Modify: `apps/api/src/app/app.module.ts` (`ConditionalModule.registerWhen(SiteContentModule, cloudMode)`)

**Interfaces:**
- Consumes: `PlatformDatabase.platformTransaction`, `PlatformAuditService.append`, `RequireOperatorPermission`,
  `RequireFreshAuth`, `@Public()`, `@Throttle`, контракты Task 1, `PUBLIC_READ_LIMIT`.
- Produces маршруты:
  - `GET operator/site-settings` → `SiteSettings`; `PUT operator/site-settings` (`content:manage`, `@RequireFreshAuth()`)
    → `SiteSettings`, аудит `site-settings.updated`; 400 `media_not_found` у несуществующего `*MediaId`.
  - `POST operator/site-media` → 201 `SiteMedia`, аудит `site-media.uploaded`; `GET operator/site-media?limit&offset` →
    `{ items: SiteMedia[]; total }`; `GET operator/site-media/{id}/content` → байты.
  - `GET public/site-info` → `PublicSiteInfo` (тарифы — `platform_settings` и видимые, не архивные `services`; ключ `tj`
    → `tg`); `GET public/media/{id}` → байты, `Content-Type` из записи, `Cache-Control: public, max-age=31536000,
    immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`.
- Produces `media-signature.ts`: `sniffImage(bytes: Buffer): { type: SiteMediaType; width: number; height: number } |
  null` — JPEG (`FF D8 FF`, размер из SOF0/SOF2), PNG (сигнатура 8 байт, IHDR), WebP (`RIFF….WEBP`, VP8/VP8L/VP8X).

- [ ] **Step 1:** Репозиторий и сервисы; загрузка: base64 → `Buffer`, > 2 МиБ — 413 `media_too_large`, `sniffImage`
  `null` или не совпал с `contentType` — 400 `unsupported_media_type`; SHA-256 (`node:crypto`) — дубль возвращает
  прежнюю запись.
- [ ] **Step 2:** Контроллеры с правами `content:manage`; публичный — `@Public()`, `@Throttle({ default:
  PUBLIC_READ_LIMIT })`; ответ байтов — `StreamableFile` или `res.end` с `@Res()`.
- [ ] **Step 3:** Проверка на dev-API (`npx nx serve api`, вход оператора `curl -c`): загрузка PNG → 201; повтор того же
  файла → тот же `id`; HTML, переименованный в `.png`, → 400 `unsupported_media_type`; `GET public/media/{id}` —
  заголовки `Cache-Control: public, max-age=31536000, immutable`; `PUT site-settings` без свежего входа → 403
  `fresh_auth_required`; `GET public/site-info` — цена 40000 (по умолчанию) и услуги.
- [ ] **Step 4:** `npx nx lint api`. Commit `feat(api): site settings and images`.

### Task 6: Юридические документы

**Files:**
- Create: `apps/api/src/app/platform/site-content/legal-documents.controller.ts`, `legal-documents.service.ts`,
  `dto/legal-documents.dto.ts`; Modify: `site-content.repository.ts`, `public-site.controller.ts`,
  `site-content.module.ts`

**Interfaces:**
- Produces: `GET operator/legal-documents` → `LegalDocumentsOverview`; `PUT operator/legal-documents/{kind}/{locale}/draft`
  → `LegalDocumentDraft`; `POST operator/legal-documents/{kind}/{locale}/publish` → `LegalDocumentRevision`, аудит
  `legal-document.published` (409 `draft_empty` без черновика; `effectiveFrom` раньше сегодня по Душанбе — 400);
  `GET public/legal-documents/{kind}?locale` → текущая ревизия языка, иначе RU, иначе 404.
- Produces для Task 8: `LegalDocumentsService.currentPrivacyId(trx, locale: UiLocale): Promise<string | null>` (с
  откатом на RU), экспорт модуля `SiteContentModule`.

- [ ] **Step 1:** Публикация — вставка ревизии из черновика; черновик остаётся (следующая правка начинается с него).
  Текст — тот же ограниченный Markdown; длины проверяет DTO, ссылки `media:` — как у статей (400 `media_not_found`).
- [ ] **Step 2:** Проверка `curl`: черновик → публикация → `GET public/legal-documents/privacy?locale=tg` отдаёт RU-ревизию
  (TG нет); вторая публикация с будущей датой — публично остаётся первая.
- [ ] **Step 3:** Commit `feat(api): offer and privacy policy revisions`.

### Task 7: Статьи и sitemap

**Files:**
- Create: `apps/api/src/app/platform/site-content/articles.controller.ts`, `articles.service.ts`, `dto/articles.dto.ts`;
  Modify: `site-content.repository.ts`, `public-site.controller.ts`

**Interfaces:**
- Produces: `GET operator/articles?status&q&limit&offset` → `{ items: ArticleListItem[]; total }`; `POST operator/articles`
  → 201 `Article`; `GET/PUT operator/articles/{id}` (PUT с `version`; несовпадение — 409 `version_conflict`);
  `POST operator/articles/{id}/publish|unpublish|archive`; аудит `article.created`, `article.updated`,
  `article.published`, `article.unpublished`, `article.archived`.
- Produces: `GET public/articles?locale&limit&offset` (по умолчанию 12, макс. 50; только `published`, есть перевод
  языка; сортировка `published_at desc`) → `{ items: PublicArticleListItem[]; total }`; `GET public/articles/{slug}?locale`
  → `PublicArticle` или 404; `GET public/sitemap` → `PublicSitemap`.

- [ ] **Step 1:** Правила: 409 `slug_taken`; slug меняется только пока `published_at is null` (A6), иначе 409
  `slug_locked`; publish — 400 `translation_required` без RU с `title` и `body`; картинки `media:<id>` из тел
  (`siteMarkdownMediaIds`) и `coverMediaId` должны существовать — 400 `media_not_found`; archive — только `draft`,
  иначе 409 `not_draft`.
- [ ] **Step 2:** Проверка `curl`: черновик по slug публично — 404; после publish — 200; unpublish — снова 404; TG-версии
  нет — `?locale=tg` → 404, в sitemap у статьи `locales: ['ru']`; две параллельные PUT с одним `version` — вторая 409.
- [ ] **Step 3:** Commit `feat(api): blog articles and the sitemap feed`.

### Task 8: Заявки на подключение

**Files:**
- Create: `apps/api/src/app/platform/connection-requests/` — `connection-requests.module.ts`,
  `connection-requests.controller.ts`, `public-connection-requests.controller.ts`, `connection-requests.service.ts`,
  `connection-requests.repository.ts`, `dto/connection-requests.dto.ts`, `connection-request-retention.ts`
- Create: `apps/api/src/app/platform/tenants/connection-request-linker.ts`, `tenant-lookup.ts`
- Modify: `apps/api/src/app/platform/tenants/tenants.service.ts`, `dto/tenant.dto.ts` (`connectionRequestId`,
  `@IsOptional() @IsUUID()`), `tenants.module.ts`
- Modify: `apps/api/src/app/platform/notifications/notification-topics.ts`, `notifications-refresh.ts`,
  `notifications.service.ts`
- Modify: `apps/api/src/app/platform/retention/prescription-purge.scheduler.ts`, `platform-retention.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `LegalDocumentsService.currentPrivacyId` (Task 6), `CONNECTION_REQUEST_LIMIT` (Task 4), `normalizeIdentifier`
  (`apps/api/src/app/auth/identifier.ts`) — телефон приводится к E.164, не телефон — 400.
- Produces: `POST public/connection-requests` (`@Public()`, `@Throttle({ default: CONNECTION_REQUEST_LIMIT })`) → 201
  без тела; 409 `privacy_not_published`; 429 `too_many_requests` сверх 200 за 24 ч (спам не считается).
- Produces: `GET operator/connection-requests?status&q&limit&offset` и `GET …/{id}` (`tenants:view`); `POST …/{id}/take`,
  `…/reject` (`RejectConnectionRequestRequest`), `…/mark-spam`, `PUT …/{id}/note` (`tenants:manage`); 409
  `request_already_decided` для решённой; аудит `connection-request.taken|rejected|marked-spam|noted|connected` с
  `entityId`, без ПДн.
- Produces порт `ConnectionRequestLinker` (абстрактный класс в `platform/tenants/connection-request-linker.ts`,
  `markConnected(trx: Transaction<DB>, requestId: string, tenantId: string): Promise<void>`): его реализует
  `connection-requests` и регистрирует как провайдер порта; `TenantsService.create` вызывает его в своей транзакции,
  если в запросе есть `connectionRequestId`. Так `connection-requests` импортирует `tenants`, а не наоборот (без цикла).
- Produces: `TenantLookup.similar(trx, inn: string | null, phone: string | null): Promise<{ id; name }[]>` (экспорт
  `platform/tenants`).
- Produces: уведомление `connection_requested` (тема `leads`, состояние — есть заявки `new`; `targetOf` → раздел
  «Заявки»); `AttentionCounts.connectionRequests` = число `new`.
- Produces: `ConnectionRequestRetention.anonymizeExpired(trx): Promise<number>` — `rejected` по `decided_at`, `spam` по
  `created_at` старше 180 дней, `anonymized_at is null`; шаг в `purgeAll()` с `{ kind: 'system', job:
  'connection-requests.anonymize' }`.

- [ ] **Step 1:** Приём: `website` непуст или `now - openedAt < 3 с` → строка со статусом `spam`, ответ 201; есть `new`/
  `in_progress` с тем же телефоном за 24 ч → ответ 201 без строки; иначе `new`. `client_ip` — `req.ip`. Ответ одинаков
  во всех трёх случаях.
- [ ] **Step 2:** Разбор оператором, `similarTenants` в карточке, `markConnected` в `TenantsService.create` (та же
  транзакция; 409 `request_already_decided`, если заявка уже `connected`/`rejected`/`spam`).
- [ ] **Step 3:** Уведомление, счётчик, обезличивание.
- [ ] **Step 4:** Проверка `curl` с `-H 'Origin: http://127.0.0.1:4400'`: без политики — 409 `privacy_not_published`;
  после публикации политики — 201; повтор с тем же телефоном — 201, строк одна; `website=x` — строка `spam`; 4-я заявка
  с адреса за час — 429; `Origin: https://evil.example` — 403; `GET operator/attention-counts` — `connectionRequests: 1`;
  «Создать сеть» с `connectionRequestId` → заявка `connected` с `tenant_id`; ручной `update … set decided_at = now() -
  interval '181 days'` у отклонённой и вызов прохода (перезапуск API, через 60 с) → ПДн `null`.
- [ ] **Step 5:** `npx nx lint api`. Commit `feat(api): connection requests from the public site`.

### Task 9: Документация

**Files:**
- Modify: `CLAUDE.md` (структура: `app/platform/site-content`, `app/platform/connection-requests`; границы:
  `site-content` ← `connection-requests` (`LegalDocumentsService`), `tenants` ← `connection-requests` (`TenantLookup`);
  `markConnected` `tenants` получает через порт `ConnectionRequestLinker`, который заполняет `connection-requests`;
  переменная `SITE_ORIGIN`; список `admin:dev-api` не меняется до части 2)
- Modify: `docs/architecture/stack.md` (ADR-0023), `docs/architecture/c4/container.md` (публичный контур; контейнер сайта —
  в части 3)

- [ ] **Step 1:** Правки документов.
- [ ] **Step 2:** Попросить пользователя запустить `npm run check` и `npx nx run api:integration`; ожидается PASS.
- [ ] **Step 3:** Commit `docs: public contour and site modules`.

## Долг тестов

- Парсер `parseSiteMarkdown` и `isSafeHref` — **первый кандидат** (защита от подмены ссылок): таблица входов из Task 3.
- `sniffImage` — JPEG/PNG/WebP, усечённые файлы, SVG/HTML.
- Приём заявки: спам-ловушка, время, дубль, суточный предел, `privacy_not_published`; `CsrfGuard` с `SITE_ORIGIN`.
- Статьи: `version_conflict`, `slug_locked`, видимость черновиков и снятых.
- Обезличивание заявок по сроку; `markConnected` в транзакции создания сети.
