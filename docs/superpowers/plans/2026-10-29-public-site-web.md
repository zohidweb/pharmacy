# Публичный сайт, часть 3 — `apps/site`, прокси и выкладка: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** посетитель и поисковик получают на `nurmed.online` готовый HTML сайта продаж: главная, тарифы, блог, оферта,
политика ПДн и форма заявки на подключение. Сайт берёт данные из публичного контура API части 1. Публикация в админке
видна на сайте не позже чем через минуту.

**Architecture:** новое Nx-приложение `apps/site` — Next.js App Router с `output: 'standalone'` и `next start` в своём
контейнере `site` (ADR-0023). Язык задаёт сегмент `[locale]`: RU открывается без префикса через `rewrites` в
`next.config`, TG — по адресам `/tg/...`. Данные читаются только из `GET /api/v1/public/*` по внутреннему адресу
`SITE_API_INTERNAL_URL`, с кешем `revalidate: 60`. Форму заявки браузер отправляет сам, через Caddy. На корневом домене
Caddy ведёт `/api/v1/public/*` в API, остальное — в `site:3000`. Пока оператор не включит сайт (`APEX_MODE=site`), apex
по-прежнему перенаправляет на `app.`.

**Tech Stack:** Next.js 16 (App Router, standalone), React 19, TypeScript strict, use-intl (`createTranslator` на сервере,
`IntlProvider` у формы), React Hook Form + zod, `@pharmacy/ui`, `@pharmacy/shared-util` (`parseSiteMarkdown`,
`formatMoney`, `formatDateOnly`, `normalizeIdentifier`), `@pharmacy/shared-domain` (`vatOf`), Tailwind v4 на `--ph-*`,
Caddy 2.11, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-28-public-site-design.md` (разделы 5, 6, 9; контракты — 7.2, 7.3), ADR-0023.
Контракты публичного контура — `libs/shared/dto/src/lib/platform-site.ts`. API части 1 не меняется: меняется только
перенос `normalizeIdentifier` в библиотеку (Task 1).

## Global Constraints

- **Тесты отложены до MVP**: новых тестов нет, кроме теста паритета словарей сайта (копия
  `apps/admin/src/shared/i18n/messages.spec.ts`). Существующие тесты остаются зелёными: `identifier.spec.ts` API, тесты
  админки и `libs/ui`. Полные проверки (`npm run check`, `api:integration`, e2e) запускает пользователь.
- ADR-0023, п. 2 — **запрещено в `apps/site`**:
  - Server Actions, `middleware`/`proxy`;
  - Route Handlers, кроме metadata-маршрутов `app/robots.ts` и `app/sitemap.ts`;
  - `dangerouslySetInnerHTML`;
  - `next/image` (картинки — обычный `<img>`);
  - новые npm-зависимости.
- Сайт не обращается к базе, Redis и секретам. В его окружении только `SITE_API_INTERNAL_URL`, `SITE_ORIGIN`,
  `WEB_ORIGIN`, `SITE_INDEXING`.
- **Сборка не обращается к API** (спецификация 5; CI собирает без API):
  - ни одна страница не пререндерится при `next build`;
  - `generateStaticParams` возвращает `[]`;
  - `robots.ts`, `sitemap.ts` и всё, что читает окружение во время запроса, — `export const dynamic = 'force-dynamic'`.
- Каждый серверный запрос к API — `fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(10_000) })`.
  Страницы с данными объявляют `export const revalidate = 60` литералом в файле маршрута: реэкспорт Next не распознаёт.
- Тексты — только через use-intl. Каждый ключ есть и в `ru.json`, и в `tg.json` (тест паритета). Таджикские строки идут
  на ревью носителя.
- Сайт не обещает 1С-выгрузку, фискализацию и офлайн-точки, не показывает вымышленных отзывов, логотипов и цифр
  (спецификация 2, анти-цели). Скриншот — только с синтетическими данными моков `apps/web`.
- `SiteText` на сайте: значение языка страницы, а если оно пустое — RU. Пустое необязательное поле не показывается.
- Деньги — `formatMoney` (дирамы, сомони). НДС — `vatOf` из `@pharmacy/shared-domain`, без float.
- Цвета, отступы и радиусы — только токены и классы кита (ADR-0007). Шрифт — `fonts.css` из `libs/ui`.
- Порт dev — `127.0.0.1:4400`; только `127.0.0.1` (S4).

## Решения автора (утверждение плана — утверждение решений)

| № | Решение |
|---|---|
| W1 | Маршруты: `app/[locale]/…`. `next.config` `rewrites().beforeFiles`: `/` → `/ru`; путь, кроме `tg`, `ru`, `_next`, `api`, `robots.txt`, `sitemap.xml`, → `/ru/<путь>`. `redirects`: `/ru` и `/ru/:path*` → без префикса (308), чтобы не было дублей для поисковиков. Неизвестный путь — catch-all `app/[locale]/[...rest]/page.tsx` → `notFound()` (своя страница 404 внутри макета языка) |
| W2 | Один корневой макет `app/[locale]/layout.tsx` с `<html lang={locale}>`. Язык не `ru` и не `tg` → `notFound()`. Макет сам ловит ошибку `site-info` (шапка и подвал рисуются с запасным названием) и никогда не падает; ошибки страниц ловит `app/[locale]/error.tsx` («Сайт временно недоступен»), последний рубеж — `app/global-error.tsx` |
| W3 | Название, когда в настройках пусто: i18n `brand.fallbackName` («Сервис для сети аптек»). Логотип — `<img src="/api/v1/public/media/<id>">`, без него — название текстом. Favicon и картинка Open Graph — из настроек через `generateMetadata` |
| W4 | «Войти» → `WEB_ORIGIN` (окружение сайта; dev — `http://localhost:4200` из `.env`) |
| W5 | Реквизиты поставщика в подвале **не показываются**: их нет в `PublicSiteInfo`, а контракт API в этой части не меняется. Добавить их — отдельная задача |
| W6 | Калькулятор тарифа (спецификация 6.3, «необязательно») не делается. На `/tariffs` — цена точки, строка «НДС N % сверху», пояснение «оплата за активные точки по дням месяца» и разовые услуги. Пример «цена с НДС» = `price + vatOf(price, vatBp)` |
| W7 | Блог: `/blog?page=N` (по 12). Страницы ≥ 2 рисуются при запросе (из-за `searchParams`), но запрос к API берётся из кеша данных (`revalidate: 60`). `page` не число или больше последней → 404 |
| W8 | Дата статьи — `formatDateOnly` (`publishedAt` → дата Душанбе, `toAppDate`) |
| W9 | Текст статьи и документов рисует общий `SiteMarkdown` из `libs/ui` (Task 1) — тот же, что в предпросмотре админки. На сайте внутренние ссылки открываются в той же вкладке, внешние (`http(s):`) — `rel="noopener nofollow"` в новой вкладке |
| W10 | Телефон и e-mail формы проверяются тем же `normalizeIdentifier`, что и в API: он переносится в `@pharmacy/shared-util`, API реэкспортирует его из `auth/identifier.ts` (carry-over части 1) |
| W11 | `/connect` без опубликованной политики ПДн (`GET public/legal-documents/privacy` → 404) показывает «Приём заявок скоро откроется» и контакты из настроек вместо формы; 409 `privacy_not_published` при отправке — тот же текст |
| W12 | Скриншот первого экрана — экран кассы `apps/web` на моках (синтетические данные), снятый Playwright в `apps/site/public/images/pos.png` (≤ 400 КБ). Скрипт съёмки не коммитится |
| W13 | Прокси: `cloud` подключает `profiles/apex/{$APEX_MODE}.caddy`. `redirect` (по умолчанию, как сейчас) — apex перенаправляет на `app.`. `site` — apex отдаёт сайт, `www.{$APEX_ADDR}` перенаправляет на apex. Профиль `local` (test) отдаёт сайт на `{$SITE_ADDR}` всегда. Включение `APEX_MODE=site` в prod — пункт чек-листа запуска: название, оферта и политика опубликованы |
| W14 | Выкладка (`.github/workflows/deploy.yml`) перед `prod:build` выполняет `npm run stack -- prod init`: новые переменные (`APEX_MODE=redirect`, `SITE_INDEXING=true`) дописываются, существующие не меняются. `init` допишет любую переменную примера, которой нет в `prod.env` на VPS, поэтому до слияния пользователь сверяет список переменных `prod.env` с примером (`deploy-vps.md`) |
| W15 | «Открыть на сайте» в редакторе статьи админки (S5 части 2). Адрес сайта — `NEXT_PUBLIC_SITE_ORIGIN`; при сборке admin он берётся из `SITE_ORIGIN`: в dev — из `.env`, в образе proxy — из build-arg. Пусто — кнопки нет. Кнопка видна только у опубликованной статьи и ведёт на `/blog/<slug>` или `/tg/blog/<slug>` по открытой вкладке языка |
| W16 | Кеш ISR в контейнере — `tmpfs` на `/app/apps/site/.next/cache`. Если на файловой системе только для чтения Next пишет куда-то ещё (`EROFS` в логах после перегенерации страницы), включается `cacheMaxMemorySize` по умолчанию и `experimental.isrFlushToDisk: false`. Если версия Next этот флаг не принимает — свой `cacheHandler` в памяти (`apps/site/cache-handler.mjs`, `Map` с пределом 50 МБ); решение записывается в отчёт задачи |

## Review Focus

1. **API недоступен при первом показе страницы.** Шапка и подвал рисуются с запасным названием, тело — «Сайт временно
   недоступен» со статусом 500. Уже показанная страница остаётся прежней (ISR). Проверка — Task 2, шаг живой проверки.
2. **Статья без TG-версии на `/tg/blog/<slug>`** — 404, в RU-статье нет hreflang `tg`, в sitemap нет TG-адреса (Task 4).
3. **Отказ при отправке формы**: 400 `phone_format` у поля, 429 с `Retry-After`, 409 `privacy_not_published`, сеть
   пропала. У каждого понятный текст, введённое сохраняется, двойной клик отправляет один запрос (Task 5).
4. **Адреса-дубли и мусор**: `/ru/blog` → 308 на `/blog`; `/tg/` и `/blog/` без 404; `/xyz` и `/tg/xyz` — своя 404 со
   статусом 404; `/blog?page=abc` — 404 (Tasks 2, 4).
5. **Индексация стенда**: в test `robots.txt` — `Disallow: /`. В prod canonical, hreflang и sitemap — абсолютные адреса
   от `SITE_ORIGIN`, без `http://` и внутренних адресов `api:3000` (Tasks 4, 6).

---

### Task 1: Общие части в библиотеках — `normalizeIdentifier` и `SiteMarkdown`

**Files:**
- Create: `libs/shared/util/src/lib/identifier.ts` (перенос кода из `apps/api/src/app/auth/identifier.ts` без изменений);
  экспорт из `libs/shared/util/src/index.ts`
- Modify: `apps/api/src/app/auth/identifier.ts` — только реэкспорт
  `export { normalizeIdentifier, type IdentifierKind, type NormalizedIdentifier } from '@pharmacy/shared-util';`
- Create: `libs/ui/src/lib/display/SiteMarkdown.tsx`; экспорт из `libs/ui/src/index.ts`
- Modify: `apps/admin/src/entities/site-content/ui/SiteMarkdownView.tsx` — тонкая обёртка над `SiteMarkdown`

**Interfaces:**
- Produces: `normalizeIdentifier(raw: string): NormalizedIdentifier | null` из `@pharmacy/shared-util` (поведение
  прежнее).
- Produces: `SiteMarkdown({ blocks, mediaSrc, links }: { blocks: SiteBlock[]; mediaSrc: (mediaId: string) => string;
  links: 'new-tab' | 'external-new-tab' })`:
  - без хуков и без `'use client'` — работает в серверных компонентах;
  - разметка и классы — из нынешнего `SiteMarkdownView`;
  - `links: 'new-tab'`: всё, кроме `mailto:`, в новой вкладке (предпросмотр админки);
  - `links: 'external-new-tab'`: только `http(s):` в новой вкладке, `/…` — в той же (сайт);
  - `rel="noopener nofollow"` — у внешних ссылок;
  - `isSafeHref` проверяется повторно.
- Admin: `SiteMarkdownView({ source })` = `useMemo(parseSiteMarkdown)` + `<SiteMarkdown blocks mediaSrc={siteMediaContentUrl} links="new-tab" />`.

- [ ] **Step 1:** перенести файл, оставить в API реэкспорт. Импорты в API (`activations.service.ts`,
  `employee-auth.repository.ts`, `connection-requests.service.ts` и др.) не меняются.
- [ ] **Step 2:** `npx nx test api --testFile=identifier.spec.ts` → PASS (тест не переносится).
- [ ] **Step 3:** создать `SiteMarkdown` и переписать `SiteMarkdownView` на него.
- [ ] **Step 4:** проверки:
  - `npx nx run-many -t lint typecheck -p shared-util ui admin api`;
  - `npx nx test admin`;
  - `npx nx fsd admin`.

  Ожидается: всё PASS, предупреждения — только те, что были до изменений.
- [ ] **Step 5:** коммит `refactor: share the identifier check and the site Markdown renderer`.

### Task 2: Каркас `apps/site` — проект, конфигурация, маршруты языков, клиент API, i18n

**Files:**
- Create (генератором, затем приведение к образцу `apps/admin`): `apps/site/{package.json, next.config.js,
  tsconfig.json, tsconfig.spec.json, eslint.config.mjs, steiger.config.mjs, postcss.config.mjs, jest.config.cts,
  next-env.d.ts, index.d.ts, specs/setup.ts}`
- Create: `apps/site/app/[locale]/{layout.tsx, page.tsx, not-found.tsx, error.tsx, [...rest]/page.tsx}`,
  `apps/site/app/global-error.tsx`
- Create: `apps/site/src/app/{index.ts, layouts/SiteLayout.tsx, styles/global.css}`
- Create: `apps/site/src/shared/config/{index.ts, env.ts}`, `apps/site/src/shared/api/{index.ts, public-api.ts}`,
  `apps/site/src/shared/i18n/{index.ts, config.ts, messages/ru.json, messages/tg.json, messages.spec.ts}`,
  `apps/site/src/shared/lib/{index.ts, site-text.ts, paths.ts}`
- Modify: `nx.json` или `package.json` — только если генератор что-то добавил. Лишнее (e2e-проект, `pages/`, примеры)
  удаляется.

**Interfaces:**
- Produces `env.ts` — читает `process.env` во время вызова, только на сервере:
  `siteEnv(): { apiInternalUrl: string; siteOrigin: string; webOrigin: string; indexing: boolean }`. Значения по
  умолчанию: `http://127.0.0.1:3000`, `http://127.0.0.1:4400`, `http://localhost:4200`; `indexing` — только
  `SITE_INDEXING === 'true'`.
- Produces `public-api.ts`:
  - `getSiteInfo(): Promise<PublicSiteInfo>`;
  - `getArticles(locale: UiLocale, page: number): Promise<Page<PublicArticleListItem>>` (limit 12);
  - `getArticle(slug: string, locale: UiLocale): Promise<PublicArticle | null>`;
  - `getLegalDocument(kind: LegalDocumentKind, locale: UiLocale): Promise<LegalDocumentRevision | null>`;
  - `getSitemap(): Promise<PublicSitemap>`;
  - `mediaPath(id: string): string` → `/api/v1/public/media/${id}` (относительный: браузер идёт через Caddy).

  `null` — только на 404. Любой другой ответ или сбой сети — `throw new SiteApiError(status | 0)`. Slug перед запросом
  кодируется `encodeURIComponent`.
- Produces `site-text.ts`: `pickText(text: SiteText, locale: UiLocale): string`.
- Produces `paths.ts`:
  - `localePath(locale: UiLocale, path: string): string` — `('ru','/blog')` → `/blog`, `('tg','/blog')` → `/tg/blog`,
    `('tg','/')` → `/tg`;
  - `absoluteUrl(path: string): string` — `siteEnv().siteOrigin + path`.
- Produces `i18n/config.ts`:
  - `locales = ['ru','tg'] as const`;
  - `isLocale(value: string): value is UiLocale`;
  - `getTranslator(locale)` → `createTranslator({ locale, messages })` из `use-intl/core`;
  - `getMessages(locale)`.

- [ ] **Step 1:** посмотреть флаги генератора `npx nx g @nx/next:application --help`. Сгенерировать
  `apps/site` (имя `site`, App Router, CSS, Jest, ESLint, без e2e) с `--dry-run`, затем без него.
- [ ] **Step 2:** привести конфигурацию к `apps/admin`:
  - `package.json`, раздел `nx`:
    - теги `scope:site`, `type:app`;
    - `build.inputs` как у admin, без `NEXT_PUBLIC_API_MOCKS`;
    - цель `dev`: `next dev -H 127.0.0.1 -p 4400`;
    - цель `fsd`: `steiger ./src`.
  - `tsconfig.json`: ссылки на 4 библиотеки, `paths: { '@/*': ['./src/*'] }`.
  - `eslint.config.mjs`: с `fsdLayerRules()`.
  - `jest.config.cts`: с тем же `transformIgnorePatterns` для use-intl.
  - `postcss.config.mjs`, `steiger.config.mjs` — как у admin.
- [ ] **Step 3:** `next.config.js`:
  - `output: 'standalone'`;
  - `outputFileTracingRoot: path.join(__dirname, '../../')`;
  - `images: { unoptimized: true }`;
  - `poweredByHeader: false`;
  - `rewrites`/`redirects` по W1;
  - только при `NODE_ENV === 'development'`: `/api/v1/public/:path*` → `${API_PROXY_TARGET ?? 'http://localhost:3000'}`.

  Регулярное выражение исключений пишется в `source` параметра (`/:path((?!tg(?:/|$)|ru(?:/|$)|_next/|api/|robots\\.txt$|sitemap\\.xml$).+)`)
  и проверяется шагом 7.
- [ ] **Step 4:** маршруты по W1 и W2:
  - `app/[locale]/layout.tsx`: `generateStaticParams = () => []`, `notFound()` для чужого языка,
    `generateMetadata` (`metadataBase` = `siteEnv().siteOrigin`, title по шаблону `%s — <название>`);
  - `SiteLayout` пока рисует `<html lang><body>{children}</body></html>` и подключает `global.css`. В `global.css` —
    тот же набор `@import` и `@source`, что у admin, плюс `@source` на `apps/site/app`;
  - главная пока заглушка с переводом `home.hero.title`.
- [ ] **Step 5:** словари `ru.json` / `tg.json`:
  - ключи `brand.*`, `nav.*`, `errors.*` (`unavailable`, `notFound`), `home.hero.title`;
  - тест паритета — копия теста admin с describe `site dictionaries`.
- [ ] **Step 6:** `npx nx run-many -t lint test build fsd -p site` → PASS. API при сборке не запущен; в логе сборки
  нет запросов к `:3000`.
- [ ] **Step 7 (живая проверка):** нужны `npx nx serve api` и `npx nx dev site`, адрес сайта — `http://127.0.0.1:4400`.
  - `/` и `/tg` — 200, `<html lang>` верный;
  - `/ru` и `/ru/blog` — 308 без префикса;
  - `/xyz` и `/tg/xyz` — 404 со своей страницей;
  - `/robots.txt` пока 404 (маршрут появится в Task 4).
  - Остановить API и открыть страницу, которой нет в кеше (Review Focus 1): ответ — «Сайт временно недоступен», а не
    стек ошибки.
- [ ] **Step 8:** коммит `feat(site): scaffold the public site app`.

### Task 3: Шапка, подвал, главная и тарифы

**Files:**
- Create: `apps/site/src/widgets/site-header/{index.ts, ui/SiteHeader.tsx, ui/LocaleSwitch.tsx}`,
  `apps/site/src/widgets/site-footer/{index.ts, ui/SiteFooter.tsx}`
- Create: `apps/site/src/pages/home/{index.ts, ui/HomePage.tsx, ui/sections/*.tsx}`,
  `apps/site/src/pages/tariffs/{index.ts, ui/TariffsPage.tsx}`
- Create: `apps/site/app/[locale]/tariffs/page.tsx`, `apps/site/public/images/pos.png`
- Modify: `apps/site/src/app/layouts/SiteLayout.tsx`, `app/[locale]/page.tsx`, `messages/{ru,tg}.json` (`home.*`,
  `tariffs.*`, `nav.*`, `footer.*`)

**Interfaces:**
- Consumes: `getSiteInfo`, `pickText`, `localePath`, `mediaPath`, `getTranslator`, `siteEnv().webOrigin`.
- Produces: `SiteHeader({ locale, info: PublicSiteInfo | null, path })`, где `path` — путь страницы без префикса языка;
  он нужен переключателю RU/TJ. `SiteFooter({ locale, info })`. `SiteLayout` рисует их вокруг `children`.

- [ ] **Step 1:** шапка по спецификации 6.2, п. 1:
  - логотип или название (W3);
  - меню: «Возможности» → `/#features`, «Тарифы», «Блог», «Контакты» → `#contacts`;
  - RU/TJ — обычные ссылки на ту же страницу другого языка;
  - «Войти» (W4) и основная кнопка «Оставить заявку» → `/connect`;
  - на узком экране меню прячется в `<details>` без JS.
- [ ] **Step 2:** подвал с `id="contacts"`:
  - ссылки на оферту и политику;
  - телефон (`tel:`), e-mail (`mailto:`), адрес, часы работы, Telegram и WhatsApp — только непустые;
  - реквизитов нет (W5).
- [ ] **Step 3:** главная — блоки 2–9 спецификации 6.2 по порядку:
  - первый экран со скриншотом `pos.png` (W12);
  - «Возможности» с `id="features"` — только перечисленное в спецификации, без 1С, фискализации и офлайна;
  - «Как подключиться» — 5 шагов;
  - «Тарифы кратко» — цена точки `formatMoney` и ссылка;
  - «Безопасность данных» — ровно пять утверждений спецификации;
  - вопросы и ответы — `<details>`;
  - призыв к заявке.

  Тексты RU пишет исполнитель. Тон — польза для владельца сети аптек, без превосходных степеней и цифр, которых у
  продукта нет. `generateMetadata`: title и description из настроек (`seoDescription`), Open Graph, `alternates`
  (canonical и hreflang `ru`, `tg`, `x-default` → RU).
- [ ] **Step 4:** `/tariffs` по W6; там же разовые услуги: название, описание, цена.
- [ ] **Step 5:** скриншот (W12). Нужен `npx nx dev web` с моками; скрипт Playwright запускается из scratchpad, канал
  `chrome` или `msedge`, окно 1280×800, экран кассы. Сохранить PNG и проверить размер.
- [ ] **Step 6:**
  - `npx nx run-many -t lint test build fsd -p site` → PASS;
  - живая проверка `/`, `/tg`, `/tariffs`, `/tg/tariffs` на настоящем API;
  - пустые настройки сайта → запасное название, пустые контакты не видны;
  - ширина 375 px — без горизонтальной прокрутки.
- [ ] **Step 7:** коммит `feat(site): header, footer, home and tariffs pages`.

### Task 4: Блог, оферта, политика, SEO — sitemap и robots

**Files:**
- Create: `apps/site/src/pages/blog/{index.ts, ui/BlogPage.tsx}`, `apps/site/src/pages/article/{index.ts,
  ui/ArticlePage.tsx}`, `apps/site/src/pages/legal/{index.ts, ui/LegalPage.tsx}`
- Create: `apps/site/src/shared/lib/seo.ts`
- Create: `apps/site/app/[locale]/blog/page.tsx`, `app/[locale]/blog/[slug]/page.tsx`, `app/[locale]/offer/page.tsx`,
  `app/[locale]/privacy/page.tsx`, `apps/site/app/robots.ts`, `apps/site/app/sitemap.ts`
- Modify: `messages/{ru,tg}.json` (`blog.*`, `legal.*`)

**Interfaces:**
- Consumes: `getArticles`, `getArticle`, `getLegalDocument`, `getSitemap`, `SiteMarkdown` (Task 1), `absoluteUrl`.
- Produces `seo.ts`: `alternates(path: string, locales: readonly UiLocale[], current: UiLocale): Metadata['alternates']`.
  - Canonical — адрес текущего языка.
  - `languages` — только переданные языки.
  - `x-default` — RU, если RU есть в списке.
  - Адреса абсолютные (`absoluteUrl`).

- [ ] **Step 1:** список статей (W7):
  - карточка — обложка (`<img loading="lazy">`), заголовок, анонс, дата (W8);
  - пагинация «Назад / Вперёд» ссылками;
  - пустой блог — текст «Статей пока нет»;
  - неверный `page` → `notFound()`.
- [ ] **Step 2:** статья:
  - `generateStaticParams = () => []`;
  - `null` от API → `notFound()`;
  - заголовок, дата, обложка, тело `SiteMarkdown(links="external-new-tab", mediaSrc=mediaPath)`;
  - `generateMetadata`: `seoTitle || title`, `seoDescription || excerpt`, `alternates` по `article.locales`
    (Review Focus 2), Open Graph `type: 'article'` с обложкой;
  - ссылка «Все статьи».
- [ ] **Step 3:** `/offer`, `/privacy`:
  - `LegalPage({ kind, locale })` — заголовок, «Действует с <дата>», тело;
  - `null` → 404;
  - API отдаёт RU, если TG нет: тогда на странице `lang="ru"` у блока текста и пометка «Текст доступен на русском».
- [ ] **Step 4:** `robots.ts` (`dynamic = 'force-dynamic'`):
  - при `indexing` — `Allow: /`, `Disallow: /api/`, `Sitemap: <SITE_ORIGIN>/sitemap.xml`;
  - без `indexing` — `Disallow: /`.
- [ ] **Step 5:** `sitemap.ts` (`dynamic = 'force-dynamic'`):
  - главная, `/tariffs`, `/blog`, `/connect` на двух языках;
  - статьи — по их `locales`;
  - документы — по `locales` из `getSitemap()`;
  - `lastModified` — из `updatedAt`, адреса — `absoluteUrl`;
  - сбой API — `throw` (500): поисковик повторит запрос, а пустой sitemap он принял бы за правду.
- [ ] **Step 6:** проверки:
  - `npx nx run-many -t lint test build fsd -p site` → PASS.
  - Живая проверка: в админке опубликовать статью только с RU. Через ≤ 60 с:
    - `/blog/<slug>` — 200, `<link rel="alternate" hreflang>` без `tg`;
    - `/tg/blog/<slug>` — 404;
    - `/sitemap.xml` без TG-адреса статьи;
    - `<b>` и `javascript:` в тексте — обычный текст;
    - `/robots.txt` в dev (`SITE_INDEXING` не задан) — `Disallow: /`.
- [ ] **Step 7:** коммит `feat(site): blog, legal pages, sitemap and robots`.

### Task 5: Форма заявки `/connect`

**Files:**
- Create: `apps/site/src/features/connection-request/{index.ts, model/schema.ts, api/submit.ts,
  ui/ConnectionRequestForm.tsx}`
- Create: `apps/site/src/pages/connect/{index.ts, ui/ConnectPage.tsx}`, `apps/site/app/[locale]/connect/page.tsx`
- Modify: `messages/{ru,tg}.json` (`connect.*`, `apiErrors.*`)

**Interfaces:**
- Consumes: `getLegalDocument('privacy', locale)` (только наличие), `getSiteInfo` (контакты закрытой формы),
  `normalizeIdentifier`.
- Produces `submit.ts`:
  `submitConnectionRequest(body: SubmitConnectionRequest): Promise<{ ok: true } | { ok: false; status: number; code:
  string; fields: { field: string; code: string }[]; retryAfterSeconds: number | null }>`.
  - Запрос: `fetch('/api/v1/public/connection-requests', { method: 'POST', headers: { 'Content-Type':
    'application/json' } })`, без cookie (`credentials: 'omit'`).
  - Сбой сети — `{ ok: false, status: 0, code: 'network' }`.
  - Тело ошибки — RFC 7807 (`code`, `errors[]`).
- Produces `ConnectionRequestForm({ locale })` — `'use client'`, внутри `IntlProvider` с `messages.connect` и
  `messages.apiErrors`. Страница передаёт сообщения пропсом.

- [ ] **Step 1:** zod-схема — те же пределы, что в `SubmitConnectionRequestDto`:
  - `networkName`, `city` — 1–120;
  - `storeCount` — целое 1–500;
  - `contactName` — 2–120;
  - `phone` — `normalizeIdentifier(v)?.kind === 'phone'`;
  - `email` — пусто или `kind === 'email'`;
  - `inn` — пусто или `^\d{9}$`;
  - `callTime` — до 100, `comment` — до 500 (со счётчиком);
  - `consent` — `true`.

  Строки обрезаются по краям. Подсказка телефона — «+992 XX XXX XX XX или 9 цифр».
- [ ] **Step 2:** форма (спецификация 6.4):
  - поле-ловушка `website`: вне экрана (`position:absolute; left:-10000px`), `tabIndex={-1}`, `autoComplete="off"`,
    `aria-hidden`;
  - `openedAt` = `new Date().toISOString()` при монтировании;
  - согласие — ссылка на `/privacy` нужного языка, открывается в новой вкладке;
  - кнопка неактивна, пока идёт отправка (Review Focus 3);
  - ошибки полей показываются у полей, первая ошибка прокручивается в видимую область.
- [ ] **Step 3:** ответы:
  - 201 — экран «Заявка принята, оператор позвонит в рабочее время» и часы работы из настроек; номера заявки нет;
  - 400 — `errors[]` раскладываются по полям: `phone_format`, `email_format`, остальное — «Проверьте поле»;
  - 409 `privacy_not_published` — текст W11;
  - 429 — «Слишком много заявок. Попробуйте через N мин.» (минуты = `ceil(Retry-After / 60)`; без заголовка — «позже»);
  - `network` и 5xx — «Нет связи с сервером, заявка не отправлена. Попробуйте ещё раз».

  Введённое не очищается ни при одной ошибке.
- [ ] **Step 4:** `ConnectPage`. Серверная часть проверяет политику (W11): нет — блок «Приём заявок скоро откроется» и
  контакты; есть — форма. `revalidate = 60`. `generateMetadata` с `alternates`.
- [ ] **Step 5:** проверки:
  - `npx nx run-many -t lint test build fsd -p site` → PASS.
  - Живая проверка на dev-API (scratch-БД части 2, политика опубликована):
    - заявка уходит, в админке видна в «Заявках»;
    - четвёртая заявка за час с того же адреса — текст 429;
    - телефон `123` — ошибка у поля без запроса к API;
    - без политики (scratch-БД без ревизий или до публикации) — закрытая форма.
- [ ] **Step 6:** коммит `feat(site): connection request form`.

### Task 6: Образ, compose, Caddy, среды и выкладка

**Files:**
- Create: `apps/site/Dockerfile`
- Modify: `docker/compose.yml` (сервис `site`), `docker/compose.dev.yml` (`site: profiles: ['site']`),
  `docker/compose.test.yml`, `docker/compose.prod.yml`
- Modify: `docker/proxy/Caddyfile` (сниппеты `public-site`, `upstream-cacheable`; `/api/v1/public*` → 404 в
  `api-tenant`)
- Create: `docker/proxy/profiles/apex/redirect.caddy`, `docker/proxy/profiles/apex/site.caddy`
- Modify: `docker/proxy/profiles/cloud.caddy`, `docker/proxy/profiles/local.caddy`
- Modify: `docker/env/test.env.example` (`SITE_ADDR=site.pharmacy-test.localhost`, `SITE_INDEXING=false`),
  `docker/env/prod.env.example` (`APEX_MODE=redirect`, `SITE_INDEXING=true`)
- Modify: `tools/scripts/stack.mjs` (комментарий и сообщение `build`: образ `site`), `.github/workflows/deploy.yml` (W14)

**Interfaces:**
- Consumes: сборка `nx build site` (standalone: `apps/site/.next/standalone/apps/site/server.js`).
- Produces: образ `pharmacy/site:${IMAGE_TAG}`. Сервис `site` слушает `:3000` в сети compose и наружу не публикуется.

- [ ] **Step 1:** `apps/site/Dockerfile` по образцу `apps/api/Dockerfile` и стадии сборки `docker/proxy/Dockerfile`.
  - Стадия сборки: тот же `NODE_IMAGE`, `npm ci`, `typecheck` четырёх библиотек, `NODE_ENV=production npx nx build site`.
  - Стадия запуска:
    - `.next/standalone` → `/app`; `.next/static` → `/app/apps/site/.next/static`; `public` → `/app/apps/site/public`;
    - удалить `*.map`, npm, corepack и yarn, как у api; код принадлежит root, `USER node`;
    - `ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1`;
    - `HEALTHCHECK`: `node -e "fetch('http://127.0.0.1:3000/robots.txt')…"`;
    - `CMD ["node", "apps/site/server.js"]`.
- [ ] **Step 2:** сервис `site` в `compose.yml`:
  - `<<: *hardened`, но `tmpfs: [/tmp, '/app/apps/site/.next/cache:size=64m,mode=1777']`;
  - `build`, `image`, `pull_policy: never`;
  - окружение:
    - `NODE_ENV: production`;
    - `NODE_OPTIONS: --max-old-space-size=160`;
    - `SITE_API_INTERNAL_URL: http://api:3000`;
    - `SITE_ORIGIN`, `WEB_ORIGIN` — обязательные, `${…:?set in the env file}`;
    - `SITE_INDEXING: ${SITE_INDEXING:-false}`;
  - `depends_on: api: service_healthy`; `logging`.

  `proxy` от `site` не зависит: сбой сайта не трогает `app.` и `admin.`. `compose.test.yml` и `compose.prod.yml`:
  `restart: unless-stopped`; ресурсы — test `0.5 CPU / 256m`, prod `1 CPU / 256m`.

  Окружение `proxy`:
  - test: `SITE_ADDR: ${SITE_ADDR:?set in the env file}`;
  - prod: `APEX_MODE: ${APEX_MODE:-redirect}`;
  - `build.args` у `proxy`: `SITE_ORIGIN: ${SITE_ORIGIN:-}` — для W15, Task 7.
- [ ] **Step 3:** Caddy.

  Сниппет `(upstream-cacheable)` — как `(upstream)`, но без `header_down Cache-Control "no-store"`.

  Сниппет `(public-site)`:
  1. `tls-{$TLS_MODE}`, `access-log`;
  2. `@media path_regexp ^/api/v1/public/media/[^/]+$` → `upstream-cacheable 30s`;
  3. `handle /api/v1/public/*` — `plain-body`, `request_body max_size 1MiB`, `encode zstd gzip`, `upstream 30s`;
  4. `handle /api/*` → `respond 404`;
  5. `handle`:
     - заголовки `static-files`, но CSP без `blob:`: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src
       'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri
       'self'; frame-ancestors 'none'; form-action 'self'`;
     - `encode zstd gzip`;
     - `reverse_proxy {$SITE_UPSTREAM:site:3000}` с `dial_timeout 5s`, `response_header_timeout 30s`.

  В `api-tenant` до `/api/*` добавить `@public path /api/v1/public /api/v1/public/*` → 404. На admin такие пути уже
  получают 404.

  Профили:
  - `cloud.caddy`: прежние `WEB_ADDR` и `ADMIN_ADDR`, затем `import /etc/caddy/profiles/apex/{$APEX_MODE}.caddy`;
  - `apex/redirect.caddy`: нынешний блок apex без изменений;
  - `apex/site.caddy`: `{$APEX_ADDR} { import public-site }` и `www.{$APEX_ADDR} { import tls-{$TLS_MODE}; redir
    https://{$APEX_ADDR}{uri} permanent }`;
  - `local.caddy`: добавить `{$SITE_ADDR} { import public-site }`.
- [ ] **Step 4:** `caddy validate` в `caddy:2.11.7-alpine` для трёх наборов переменных: `cloud`+`redirect`,
  `cloud`+`site`, `local`. Ожидается `Valid configuration` для каждого.
- [ ] **Step 5:** env-примеры, сообщение `stack.mjs`. В `deploy.yml` перед `npm run prod:build` — строка
  `npm run stack -- prod init`.
- [ ] **Step 6:** образ сайта:
  - `docker build -f apps/site/Dockerfile -t pharmacy/site:check .`;
  - запуск только для чтения, с tmpfs и `SITE_API_INTERNAL_URL` на dev-API (`host.docker.internal:3000` или сеть dev);
  - `robots.txt` — 200;
  - страница с данными открывается дважды с разницей больше 60 с: в логах нет `EROFS`, иначе — по W16;
  - память процесса после 50 запросов (`docker stats`) < 256 МБ.
- [ ] **Step 7:** стенд test (по возможности; если стенд занят другой работой — отметка в отчёте):
  - `npm run stack -- test init`, затем `test build` и `test up` → все сервисы healthy;
  - `https://site.pharmacy-test.localhost:8443/` — сайт, `robots.txt` — `Disallow: /`;
  - `…/api/v1/public/site-info` — 200;
  - `https://pharmacy-test.localhost:8443/api/v1/public/site-info` — 404.
- [ ] **Step 8:** коммит `feat(docker): site image, compose service and the apex route of the proxy`.

### Task 7: «Открыть на сайте» в админке и документация

**Files:**
- Modify: `apps/admin/next.config.js` (`env.NEXT_PUBLIC_SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN ??
  process.env.SITE_ORIGIN ?? ''`), `apps/admin/package.json` (`build.inputs` + `{ "env": "SITE_ORIGIN" }`),
  `docker/proxy/Dockerfile` (`ARG SITE_ORIGIN`, передать в `RUN` сборки admin)
- Modify: страница редактора статьи `apps/admin/src/pages/site/article/ui/*` (кнопка W15), `apps/admin` `messages/{ru,tg}.json`
- Modify: `CLAUDE.md`:
  - структура: `apps/site`;
  - «Build / test / lint»: `npx nx dev site` (4400, `/api/v1/public/*` → :3000), `nx fsd site`;
  - «Environments»: `SITE_ADDR`, `APEX_MODE`, `SITE_INDEXING`, сервис `site`;
  - «Containers»: образ `pharmacy/site`, apex;
  - формулировку «Сам сайт… — часть 3» убрать.
- Modify: `docs/architecture/c4/container.{md,mmd}` и `deployment.{md,mmd}` — контейнер `site` и его связи: Caddy → site,
  site → API (публичный контур). PNG в `img/` перестроить `npx -y @mermaid-js/mermaid-cli -p
  docs/architecture/c4/puppeteer-config.json`, если команда доступна; иначе — пометка в отчёте и в тексте PR.
- Modify: `docs/architecture/stack.md` (Frontend, Reverse proxy — без «будет»), `docs/guides/deploy-vps.md` (раздел
  «Публичный сайт»: DNS-записи `@` и `www`, чек-лист включения `APEX_MODE=site` — название и логотип в настройках,
  оферта и политика опубликованы, `SITE_INDEXING=true`; затем `prod:up`), `docs/qa/01-zapusk-do-pervogo-cheka.md`
  (раздел «Публичный сайт» на стенде test: адрес, форма, заявка в админке, `robots.txt`)

- [ ] **Step 1:** кнопка W15 — `Button variant="secondary"` со ссылкой `target="_blank" rel="noopener"`.
- [ ] **Step 2:** документы. Проверка `node tools/scripts/check-docs.mjs` → без ошибок.
- [ ] **Step 3:** `npx nx run-many -t lint test build fsd -p admin site` → PASS. Живая проверка кнопки в
  `admin:dev-api` (адрес сайта из `.env`).
- [ ] **Step 4:** коммит `docs: public site app, apex route and launch checklist; admin: open an article on the site`.
