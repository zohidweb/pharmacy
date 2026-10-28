# Публичный сайт, часть 2 — блок «Сайт» в админке: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** оператор в админке разбирает заявки с сайта (и создаёт из них сеть), ведёт статьи блога, оферту и политику
ПДн, картинки и настройки сайта — всё на готовом API части 1.

**Architecture:** новый раздел меню «Сайт» в `apps/admin` (FSD, ADR-0017): пять страниц на маршрутах `/site/*`,
сущности `connection-request` и `site-content`, фичи выбора картинки и отрисовки ограниченного Markdown. API не
меняется; Caddy получает правило тела 3 МиБ для загрузки картинок на домене админки.

**Tech Stack:** Next.js static export, React, TanStack Query, React Hook Form + zod, use-intl (RU/TG), `@pharmacy/ui`,
`@pharmacy/shared-util` (`parseSiteMarkdown`), Tailwind на `--ph-*`, Caddy.

**Spec:** `docs/superpowers/specs/2026-10-28-public-site-design.md` (раздел 8; контракты — 7.2), ADR-0023. API части 1 —
`apps/api/src/app/platform/site-content`, `.../connection-requests`; контракты — `libs/shared/dto/src/lib/platform-site.ts`.

## Global Constraints

- **Тесты отложены до MVP**: новых тестов нет; существующие (`navigation.spec.ts`, `messages.spec.ts`,
  `client.spec.ts`, `apps/admin/specs/*.spec.tsx`) — зелёные. Полные проверки запускает пользователь.
- Каждый новый маршрут API: ключ в `apps/admin/src/shared/api/routes.ts` (`'<resource>.<verb>'`), обработчик мока
  (типы требуют), ключ в `REAL_API_ROUTES` (`client.ts`) — экраны работают на настоящем API в `partial`.
- Тексты — только через use-intl; каждый ключ в `ru.json` и `tg.json` (тест паритета). Таджикские строки — на ревью носителя.
- Статический экспорт: id — в query (`?id=`), страницы с `useSearchParams` — в `Suspense` со `Spinner` (как `CompanyPage`).
- Никакого `dangerouslySetInnerHTML`; Markdown рисуется из дерева `parseSiteMarkdown` React-элементами.
- Картинки в админке грузятся с `GET /api/v1/operator/site-media/{id}/content` (публичный контур на домене админки закрыт).
- Новые иконки — в закрытый набор `libs/ui/src/lib/icon/icons.ts`, стилями кита; цвета и размеры — только токены.
- Права на клиенте не проверяются (в админке одна роль); 403 показывает `QueryState`.
- Повторный вход: `fresh_auth_required` (сохранение настроек сайта, публикация оферты и политики, создание сети)
  показывается текстом `apiErrors.fresh_auth_required` в `Alert` формы — как на «Настройках».

## Решения автора (утверждение плана — утверждение решений)

| № | Решение |
|---|---|
| S1 | Маршруты: `/site/requests`, `/site/requests/view?id=`, `/site/articles`, `/site/articles/edit?id=` (без `id` — новая статья), `/site/documents`, `/site/media`, `/site/settings`. Раздел меню `site` («Сайт») после «Клиенты»: Заявки (счётчик `connectionRequests`), Статьи, Документы, Картинки, Настройки сайта |
| S2 | Карточка заявки: поля, «похожие сети» ссылками, заметка оператора, «Взять в работу», «Создать сеть» (→ `/companies/new?request=<id>`), «Отклонить» (диалог, причина 5–500), «Спам» (подтверждение). История статусов не показывается — её нет в контракте; видны создана / взял / решено |
| S3 | «Новая компания» с `?request=<id>`: форма заполняется из заявки (название, город, ИНН, ФИО, телефон, логин = телефон, e-mail), сверху плашка «Из заявки …», в запрос уходит `connectionRequestId`; 409 `request_already_decided` — текст ошибки |
| S4 | Редактор статьи: вкладки RU/TG (заголовок, анонс, текст, SEO-заголовок ≤ 70 и описание ≤ 160 со счётчиками); текст — поле ввода с панелью вставки (заголовок, список, ссылка, картинка из библиотеки, таблица) и предпросмотром тем же рендером; slug — транслитерация RU-заголовка, пока статья не публиковалась, после — только чтение; обложка из библиотеки. Кнопки: «Сохранить», «Опубликовать», «Снять с публикации», «В архив» (только черновик). `version_conflict` — «Статью изменил другой оператор. Обновите страницу» |
| S5 | У кнопок «Опубликовать» статьи и документа — подсказка «Сайт обновится в течение минуты» (спецификация 8). Скрыть язык статьи — очистить её текст (R5 части 1); подсказка об этом у вкладки TG. «Открыть на сайте» — в части 3 (адрес сайта админке пока не известен) |
| S6 | Документы: вкладки «Оферта» / «Политика ПДн» × RU/TG: черновик (заголовок, текст, «Действует с» ≥ сегодня по Душанбе), «Сохранить черновик», «Опубликовать новую редакцию» (повторный вход), список прошлых редакций только для чтения, предпросмотр |
| S7 | Картинки: таблица с миниатюрой, подписью, типом, размером и пикселями; «Загрузить» — скрытый `<input type=file accept="image/png,image/jpeg,image/webp">`, проверка типа и 2 МиБ до отправки, подпись в диалоге; «Скопировать вставку» → `![подпись](media:<id>)`. Удаления нет (API его не даёт) |
| S8 | Выбор картинки — общий диалог (фича `site-media-picker`): поиск по подписи на текущей странице, загрузка прямо из диалога |
| S9 | Настройки сайта: название, слоган, SEO-описание, адрес, часы работы (RU/TG), телефон, e-mail, Telegram, WhatsApp, логотип и favicon (PNG/WebP), картинка Open Graph; повторный вход при сохранении |
| S10 | Моки: `mocks/db-site.ts` + `mocks/handlers-site.ts` — простая память, достаточно для `dev` и тестов; без логики спама и лимитов |
| S11 | Caddy: на домене админки `POST /api/v1/operator/site-media` — тело до 3 МиБ (как в API), раньше общего правила 1 МиБ |
| S12 | Уведомления: `connectionRequests` в `event-href` ведёт на `/site/requests`; тема `leads` — в списке тем страницы уведомлений; профиль оператора показывает право «Сайт» |

## Review Focus

1. **Двое операторов правят одну статью** — второй «Сохранить» получает 409 и понятный текст, введённое не теряется
   (Task 5, живая проверка в двух вкладках).
2. **Картинка больше 2 МиБ или не того типа** — отказ до отправки с текстом, без запроса к API (Task 3).
3. **Создание сети из уже решённой заявки** (второй оператор успел отклонить) — текст `request_already_decided`, сеть не
   создаётся (Task 2).
4. **Ссылка `javascript:` или HTML в тексте статьи** — в предпросмотре обычный текст (Task 4, рендер дерева).
5. **Публикация оферты без повторного входа** — текст «Выйдите и войдите снова», черновик не теряется (Task 4).

---

### Task 1: Слой API админки — маршруты, моки, ошибки, сущности

**Files:**
- Modify: `apps/admin/src/shared/api/routes.ts`, `apps/admin/src/shared/api/client.ts` (`REAL_API_ROUTES`),
  `apps/admin/src/shared/api/error-message.ts` (`knownCodes`), `apps/admin/src/shared/api/mocks/transport.ts`
- Create: `apps/admin/src/shared/api/mocks/db-site.ts`, `apps/admin/src/shared/api/mocks/handlers-site.ts`
- Create: `apps/admin/src/entities/connection-request/{index.ts,api/connection-request-queries.ts,ui/RequestStatusPill.tsx}`
- Create: `apps/admin/src/entities/site-content/{index.ts,api/site-content-queries.ts,ui/ArticleStatusPill.tsx}`
- Modify: `apps/admin/src/shared/i18n/messages/{ru,tg}.json` (`apiErrors.*`, `site.status.*`, `site.requestStatus.*`)

**Interfaces:**
- Produces ключи маршрутов: `connectionRequests.list` (query `{ status?: string; q?; limit; offset }` — статусы через
  запятую), `connectionRequests.get`, `.take`, `.reject` (`RejectConnectionRequestRequest`), `.markSpam`, `.note`
  (`ConnectionRequestNoteRequest`); `articles.list` (query `{ status?; q?; limit; offset }`), `articles.get`,
  `articles.create`, `articles.update` (`SaveArticleRequest`), `articles.publish|unpublish|archive`;
  `legalDocuments.overview`, `legalDocuments.saveDraft` (params `{ kind; locale }`), `legalDocuments.publish`;
  `siteMedia.list` (`Page<SiteMedia>`), `siteMedia.upload` (`UploadSiteMediaRequest`); `siteSettings.get`,
  `siteSettings.update`. Пути — как в API (`/operator/...`).
- Produces: `connectionRequestKeys = { all, list(query), detail(id) }`, `useConnectionRequestList(query)`,
  `useConnectionRequest(id)`; `siteKeys = { articles(query), article(id), legal, media(query), settings }`,
  `useArticleList`, `useArticle(id)`, `useLegalDocuments()`, `useSiteMediaList(query)`, `useSiteSettings()`;
  `siteMediaContentUrl(id: string): string` → `/api/v1/operator/site-media/${id}/content`.
- Produces: `RequestStatusPill({ status })`, `ArticleStatusPill({ status })` (`StatusPill` с тонами: new — attention,
  in_progress — info, connected — success, rejected — neutral, spam — danger; draft — neutral, published — success,
  unpublished — warning, archived — neutral).
- Produces в `knownCodes` и `apiErrors`: `version_conflict`, `slug_taken`, `slug_locked`, `translation_required`,
  `not_published`, `not_draft`, `archived`, `draft_empty`, `media_not_found`, `media_too_large`, `unsupported_media_type`,
  `request_already_decided`, `not_found` (если ещё нет) — сверить точный список кодов с сервисами API.

- [ ] **Step 1:** Маршруты, обработчики мока (в памяти: списки с `limit/offset`, создание, смена статуса; заявки — пять
  синтетических; картинки — две маленьких PNG в base64), ключи `REAL_API_ROUTES`, коды ошибок с RU/TG.
- [ ] **Step 2:** Сущности и плашки статусов.
- [ ] **Step 3:** `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx nx lint admin`, `npx nx fsd admin`, тесты
  `messages.spec.ts`, `client.spec.ts` (`cd apps/admin && node ../../node_modules/jest/bin/jest.js --config
  jest.config.cts --testMatch '**/<name>.spec.ts'` — точечная папка `.claude` ломает обычный glob) — PASS.
- [ ] **Step 4:** Commit `feat(admin): site API layer — routes, mocks, entities`.

### Task 2: Раздел «Сайт» в меню и заявки

**Files:**
- Modify: `apps/admin/src/shared/config/routes.ts` (`siteRequests`, `siteRequest(id)`, `siteArticles`, `siteArticle(id?)`,
  `siteDocuments`, `siteMedia`, `siteSettings`), `apps/admin/src/widgets/app-shell/config/navigation.ts` (секция
  `site`, `counter` + `'connectionRequests'`), `apps/admin/src/widgets/app-shell/ui/Sidebar.tsx` (если нужно для
  счётчика), `apps/admin/src/entities/event/lib/event-href.ts`, `apps/admin/src/pages/notifications/ui/NotificationsPage.tsx`
  (тема `leads`), `apps/admin/src/pages/profile/ui/ProfilePage.tsx` (право «Сайт»)
- Create: `apps/admin/app/(shell)/site/requests/page.tsx`, `.../site/requests/view/page.tsx`,
  `apps/admin/src/pages/site-requests/`, `apps/admin/src/pages/site-request/`
- Modify: `apps/admin/src/pages/company-create/ui/CompanyCreatePage.tsx`, `.../model/create-tenant-schema.ts`
- Modify: `libs/ui/src/lib/icon/icons.ts` (иконки `globe`, `image`, `upload`, `newspaper`, `link` — по образцу соседних)

**Interfaces:**
- Consumes: Task 1 (маршруты, `useConnectionRequestList`, `useConnectionRequest`, `RequestStatusPill`).
- Produces: `toCreateTenantRequest(values, connectionRequestId?: string)`; секция меню `site` — Tasks 3–6 только
  добавляют в неё пункты.

- [ ] **Step 1:** Маршруты и секция меню (пока с одним пунктом «Заявки»), счётчик `connectionRequests` с ключом
  `shell.counters.connectionRequests`, переход из уведомления, тема `leads`, право «Сайт» в профиле.
- [ ] **Step 2:** Список заявок (S2: фильтр статусов чипами — «Открытые» по умолчанию, поиск, таблица, пагинация по 20,
  как `AuditLogPage`) и карточка (S2).
- [ ] **Step 3:** Предзаполнение «Новой компании» (S3), инвалидация `connectionRequestKeys.all` и счётчиков после создания.
- [ ] **Step 4:** Живая проверка: API из ворктри (`.env` → отдельная БД, порт 3010; `npx nx serve api`), админка
  `NEXT_PUBLIC_API_MOCKS=partial API_PROXY_TARGET=http://127.0.0.1:3010 npx next dev apps/admin -H 127.0.0.1 -p 4310`
  (`ADMIN_ORIGIN` в `.env` должен быть `http://127.0.0.1:4310` на время проверки — правка `.env` ворктри допустима, не
  печатать его); во встроенном браузере на `http://127.0.0.1:4310`: создать заявку `curl`-ом на публичный контур
  (`Origin: http://127.0.0.1:4400`), увидеть счётчик, взять, создать сеть из заявки (сеть создана, заявка
  «Подключена»), повторить с отклонённой — текст `request_already_decided`. Снимок экрана — в отчёт.
- [ ] **Step 5:** tsc, lint, fsd, `navigation.spec.ts`, `messages.spec.ts`, `apps/admin/specs/*.spec.tsx` — PASS. Commit
  `feat(admin): site section and connection requests`.

### Task 3: Картинки и выбор картинки

**Files:**
- Create: `apps/admin/src/shared/lib/file-to-base64.ts`, `apps/admin/app/(shell)/site/media/page.tsx`,
  `apps/admin/src/pages/site-media/`, `apps/admin/src/features/site-media-upload/`,
  `apps/admin/src/features/site-media-picker/`
- Modify: `navigation.ts` (пункт «Картинки»)

**Interfaces:**
- Produces: `fileToBase64(file: File): Promise<string>` — `file.arrayBuffer()`, кодирование кусками по 32 КиБ через
  `btoa` (без `FileReader` и data-URL); `SITE_MEDIA_MAX_BYTES = 2 * 1024 * 1024`;
  `UploadSiteMediaButton({ onUploaded(media: SiteMedia) })`;
  `SiteMediaPickerDialog({ open, onClose, onPick(media: SiteMedia), accept?: SiteMediaType[] })`.

- [ ] **Step 1:** Хелпер, кнопка загрузки (S7: проверка типа и размера до отправки — тексты `site.media.errors.type`,
  `.size`; диалог подписи), страница (S7), диалог выбора (S8).
- [ ] **Step 2:** Живая проверка (как Task 2): загрузка PNG → миниатюра; файл 3 МиБ и `.gif` — отказ без запроса
  (вкладка сети браузера пуста); «Скопировать вставку» кладёт `![подпись](media:<uuid>)`.
- [ ] **Step 3:** tsc, lint, fsd, тесты админки — PASS. Commit `feat(admin): site images`.

### Task 4: Отрисовка Markdown и документы

**Files:**
- Create: `apps/admin/src/entities/site-content/ui/SiteMarkdownView.tsx`, `.../ui/SiteMarkdownToolbar.tsx`
- Create: `apps/admin/app/(shell)/site/documents/page.tsx`, `apps/admin/src/pages/site-documents/`
- Modify: `navigation.ts` (пункт «Документы»)

**Interfaces:**
- Consumes: `parseSiteMarkdown`, `SiteBlock`, `SiteInline` (`@pharmacy/shared-util`); `SiteMediaPickerDialog` (Task 3);
  `siteMediaContentUrl` (Task 1).
- Produces: `SiteMarkdownView({ source: string })` — заголовки h2/h3, абзацы, списки, цитата, таблица, картинка
  (`<img src={siteMediaContentUrl(id)} alt={caption}>`), ссылки (`rel="noopener nofollow"`, внешние — `target="_blank"`);
  `SiteMarkdownToolbar({ textareaRef, value, onChange })` — вставка шаблонов в позицию курсора: `## `, `- `,
  `[текст](https://)`, картинка через диалог выбора, таблица `| A | B |\n|---|---|\n|  |  |`.

- [ ] **Step 1:** Рендер и панель вставки.
- [ ] **Step 2:** Страница документов (S6): форма черновика, предпросмотр, публикация, список редакций.
- [ ] **Step 3:** Живая проверка: черновик политики RU → публикация без свежего входа — текст «Выйдите и войдите
  снова», черновик на месте; после повторного входа — редакция в списке; текст с `[x](javascript:alert(1))` и
  `<b>` в предпросмотре — обычный текст.
- [ ] **Step 4:** tsc, lint, fsd, тесты админки — PASS. Commit `feat(admin): site Markdown view and legal documents`.

### Task 5: Статьи

**Files:**
- Create: `apps/admin/app/(shell)/site/articles/page.tsx`, `.../site/articles/edit/page.tsx`,
  `apps/admin/src/pages/site-articles/`, `apps/admin/src/pages/site-article/`,
  `apps/admin/src/shared/lib/slugify.ts`
- Modify: `navigation.ts` (пункт «Статьи»)

**Interfaces:**
- Consumes: Task 1 (маршруты статей, `useArticleList`, `useArticle`, `ArticleStatusPill`), Task 3 (выбор обложки),
  Task 4 (`SiteMarkdownView`, `SiteMarkdownToolbar`).
- Produces: `slugify(title: string): string` — транслитерация русских и таджикских букв (ғ→g, ӣ→i, қ→q, ӯ→u, ҳ→h,
  ҷ→j, ё→yo, ж→zh, х→kh, ц→ts, ч→ch, ш→sh, щ→shch, ю→yu, я→ya, ъ/ь — пропуск), латиница и цифры, остальное — `-`,
  схлопывание `-`, обрезка до 120, результат подходит под `^[a-z0-9]+(-[a-z0-9]+)*$` или `''`.

- [ ] **Step 1:** Список (S4: чипы статусов — по умолчанию все, кроме архива; поиск; таблица: заголовок RU, статус,
  языки, публикация, изменена; «Новая статья»).
- [ ] **Step 2:** Редактор (S4, S5): создание `POST`, затем `PUT` с `version` из ответа; кнопки статусов; обработка
  `version_conflict`, `slug_taken`, `slug_locked`, `translation_required`, `media_not_found` — текстом у поля или в `Alert`.
- [ ] **Step 3:** Живая проверка: новая статья → черновик → публикация → `GET /api/v1/public/articles/<slug>` через
  `curl` с `Origin` сайта отдаёт 200; правка в двух вкладках — вторая получает текст конфликта, введённое остаётся в
  форме; slug после публикации только для чтения.
- [ ] **Step 4:** tsc, lint, fsd, тесты админки — PASS. Commit `feat(admin): blog articles`.

### Task 6: Настройки сайта

**Files:**
- Create: `apps/admin/app/(shell)/site/settings/page.tsx`, `apps/admin/src/pages/site-settings/`
- Modify: `navigation.ts` (пункт «Настройки сайта»)

**Interfaces:**
- Consumes: `useSiteSettings`, `siteSettings.update` (Task 1), `SiteMediaPickerDialog` с `accept` (Task 3).

- [ ] **Step 1:** Форма S9 (zod: телефон `''` или E.164, e-mail, `https://t.me/…`, `https://wa.me/…`, длины как в API),
  сохранение, текст повторного входа.
- [ ] **Step 2:** Живая проверка: сохранение без свежего входа → текст; после входа → `GET /api/v1/public/site-info`
  отдаёт новое название; логотип только PNG/WebP (JPEG не предлагается в выборе).
- [ ] **Step 3:** tsc, lint, fsd, тесты админки — PASS. Commit `feat(admin): site settings`.

### Task 7: Caddy, документация, хвосты части 1

**Files:**
- Modify: `docker/proxy/Caddyfile` (`(api-operator)`: `@siteMedia path /api/v1/operator/site-media` до общего
  `handle @operator`, `request_body { max_size 3MiB }`, `plain-body`, `encode`, `upstream 30s` — с комментарием по образцу
  `@imports`)
- Modify: `CLAUDE.md` (список `admin:dev-api` + «сайт: заявки, статьи, документы, картинки, настройки»; строка ~454 —
  правило Caddy 3 МиБ уже в прокси), `apps/api/migrations/1793186000000_public-site-checks.sql` (только комментарий:
  NOT VALID и VALIDATE в одной транзакции миграции — облегчения блокировки нет, таблица новая)
- Modify: `docs/qa/` — короткий раздел «Сайт в админке» в подходящем файле (где описаны экраны админки)

- [ ] **Step 1:** Правки.
- [ ] **Step 2:** Проверка Caddy: `docker run --rm -v "<abs>/docker/proxy:/etc/caddy:ro" caddy:2.11.7-alpine caddy
  validate --config /etc/caddy/Caddyfile --adapter caddyfile` с переменными среды как в `docker/env/test.env.example`
  (или способ, которым это делали в PR прокси — см. `docs/guides`); ожидается `Valid configuration`.
- [ ] **Step 3:** Commit `docs: site section in the admin; proxy: 3 MiB image uploads on the admin host`.

## Долг тестов

- `slugify` (таджикские буквы, пустой результат), `fileToBase64` (большой файл кусками), `SiteMarkdownView` (каждый
  тип блока, небезопасные ссылки), экраны «Сайт» в `apps/admin/specs` (заявка → сеть; конфликт версии статьи).
