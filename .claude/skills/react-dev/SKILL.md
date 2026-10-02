---
name: react-dev
description: Pharmacy React conventions for apps/web (POS, warehouse, owner cabinet) and apps/admin (platform operator) — Next.js static export, Feature-Sliced Design layers (ADR-0017), TanStack Query + thin fetch API client over libs/shared/dto types, Zustand, React Hook Form + zod, use-intl RU/TJ, idb offline outbox with UUIDv7 idempotency, libs/ui kit with Tailwind on --ph-* tokens, permissions from the session profile for UI only, Jest + Playwright + axe. Use when writing, reviewing or refactoring React code in apps/web, apps/admin or libs/ui — экраны, срезы FSD, формы, касса, буфер перебоев, i18n.
---

# Конвенции проекта Pharmacy — React

Источники истины: `CLAUDE.md`, ADR-0004 (Next.js static export), ADR-0007 (UI и стили),
ADR-0009 (тесты), ADR-0015 (фронтенд-библиотеки), ADR-0017 (FSD), ADR-0018 (права). При
расхождении со скилом прав ADR.

## 1. Структура — Feature-Sliced Design (ADR-0017)

```
apps/<web|admin>/
├── app/            # Next.js routes ONLY: one-line re-exports of pages from src/pages
├── pages/          # empty, README only — keeps Next.js from treating src/pages as routes. Do not delete
└── src/            # FSD layers with canonical names
    ├── app/        # providers, global styles (styles/), i18n provider, Service Worker; RootLayout in layouts/
    ├── pages/      # screens: composition of widgets/features; one slice = one route
    ├── widgets/    # large self-contained UI blocks (header, sidebar, receipt panel)
    ├── features/   # user actions with business value (complete a receipt, accept a transfer)
    ├── entities/   # business entities (product, batch, receipt, employee, store)
    └── shared/     # app-local base: api client, config, i18n keys, offline-queue
```

- **Файл маршрута** — одна строка: `export { ReceiptViewPage as default } from '@/pages/receipt-view';`.
  Маршруты статические, id и фильтры — в query (`/receipts/view?id=…`); `useSearchParams` — только
  внутри `<Suspense>`. API routes, middleware, SSR/ISR, Server Actions не используются (ADR-0004).
- **Порядок слоёв:** `app → pages → widgets → features → entities → shared`; слой импортирует только
  слои ниже. Срезы одного слоя друг друга не импортируют; связь `entities` — только через `@x`
  (`@/entities/batch/@x/receipt`).
- **Public API:** у каждого среза `index.ts`; импорт внутрь среза (`@/pages/home/ui/HomePage`) запрещён.
- **Сегменты:** `ui`, `model`, `api`, `lib`, `config`. В слое `app` сегмента `ui` нет (Steiger
  `fsd/no-ui-in-app`) — раскладка приложения живёт в `src/app/layouts`.
- **«Pages first»:** код экрана живёт в срезе страницы и опускается в `widgets` / `features` /
  `entities`, только когда понадобился второму экрану. Пустые слои заранее не создаются.
- **Алиас** `@/*` → `src/*`. Общий для web и admin слой `shared` — Nx-библиотеки: `@pharmacy/ui`
  (UI-кит), `@pharmacy/shared-util` (деньги, даты, i18n-форматирование), `@pharmacy/shared-dto`,
  `@pharmacy/shared-domain` (типы и каталог прав). Типы API и домена объявляются **только** там;
  срезы `entities` их не переопределяют.
- **Проверка:** `npx nx fsd web` / `npx nx fsd admin` (Steiger) и ESLint `no-restricted-imports`
  по слоям (`tools/eslint-rules/fsd-layers.mjs`) — оба в `npm run check`.
- Из-за корневой `pages/` хуки `usePathname()`, `useSearchParams()`, `useParams()` типизированы как
  возможно `null` — проверяйте результат.

## 2. Данные и API (ADR-0015)

- **Клиент API** — свой тонкий `apiRequest` на `fetch` в `shared/api`: `credentials: 'same-origin'`,
  тело только `application/json`, `X-Correlation-Id` на каждом запросе, `Idempotency-Key` для
  финансовых операций, таймаут `AbortSignal.timeout`, разбор problem+json в
  `ApiError { status, code, correlationId, errors[] }`, 401 — переход на вход/PIN. Карта маршрутов
  `ApiRoutes` сверяется тестом с маршрутами Nest. `axios` во фронтендах не используется.
- **Типы** — `import type { … } from '@pharmacy/shared-dto'`; `class-validator`/`class-transformer`
  во фронтендах запрещены (ESLint).
- **Серверные данные** — TanStack Query 5 (`entities/*/api`, `features/*/api`); `onlineManager`
  подключён к своему детектору связи (пинг `/api/v1/health` + ошибки запросов). Серверные списки
  в Zustand не копируются.
- **Клиентское состояние** — Zustand 5 для доменного состояния терминала (черновик чека,
  PIN-сессия и смена, выбранная точка, режим связи), селекторы, а не весь store; остальное —
  локальный state. Редьюсер чека (строки, скидка, оплаты, итог в дирамах) — чистые функции.
- **Формы** — React Hook Form 7 + zod 4 (`@hookform/resolvers`); на маршрутах кассы — `zod/mini`.
  Сервер — источник правды: `errors[]` из problem+json раскладываются в поля (`setError`).
  Сообщения zod — ключи i18n. Для пары «DTO ↔ схема формы» — общий набор примеров, который
  проверяется и `class-validator` (в тесте `libs/shared/dto`), и zod (в тесте фронтенда).
- **Деньги** — integer дирамы; форматирование и округление — только `@pharmacy/shared-util`.
  Валюта одна — TJS (ADR-0016).

## 3. Касса: буфер перебоев и Service Worker (ADR-0015)

- **Outbox-first:** операция (продажа с оплатами, операции смены) получает UUIDv7 (`uuid`, `v7`)
  при нажатии «Оплатить», пишется в хранилище `outbox` IndexedDB (`idb`, модуль
  `shared/lib/offline-queue`) одной транзакцией с изменением черновика, затем отправляется.
  Этот UUIDv7 — `operationId` операции: он уходит и в теле, и в заголовке `Idempotency-Key`
  (сервер сверяет их, `nestjs-rest-workflow.md`).
- Один отправитель на терминал (`navigator.locks`), FIFO, повтор с экспоненциальной задержкой и
  джиттером (до 60 с). 2xx — удалить; 401/403 — пауза до восстановления сессии; 409/400/422 —
  **карантин** (не удалять, ключ не перегенерировать). Ни одна операция не удаляется молча.
- Снимок каталога и цен точки — в IndexedDB и `Map<barcode, product>`: скан и поиск работают при
  перебое; продажа принимается сервером по цене из снимка (`priceListVersion`).
- Склад, закупки, возвраты и отчёты при отсутствии связи недоступны — явное сообщение в UI.
- **Данные рецепта ПКУ** в буфере шифруются AES-GCM (Web Crypto) — ADR-0015.
- **Service Worker** — свой минимальный, только облачная сборка `apps/web`: манифест из `out/`,
  `/api/*` не кэшируется, kill-switch, обновление — только между чеками.
- **Сканер** — собственный обработчик по `event.code` с настраиваемыми порогами (не библиотека).

## 4. UI и стили (ADR-0007)

- Только компоненты UI-кита `@pharmacy/ui` (свой, без UI-зависимостей рантайма); новые примитивы —
  в `libs/ui`, не в приложениях. UI-библиотеки (MUI, Ant, Radix, Base UI…) — только через ADR.
- Tailwind v4 поверх токенов `--ph-*` — для раскладки (`className`); без произвольных значений
  (`p-[13px]`), hex и «сырых» px — скилы `tailwind-patterns`, `ui-standards-tokens`.
- Классы склеиваются своим `cx()` из UI-кита; иконки — свой SVG-набор.
- Браузеры — Chrome/Edge последних двух версий; экраны кассы от 10″, сенсорные цели ≥ 48 px.

## 5. i18n RU/TJ (ADR-0015)

- use-intl: `IntlProvider` в `src/app`, ICU, типизированные ключи; словари `ru` / `tg` грузятся
  по требованию; `<html lang>` меняется вместе с локалью.
- Ключи — английские идентификаторы; строки UI-кита — тоже из словарей; нормализация `NFC`
  перед поиском и печатью. Названия товаров и справочников приходят из API объектом по языкам
  (`{ ru, tj }`) — показывайте язык пользователя, иначе язык сети по умолчанию.

## 6. Аутентификация и права (ADR-0008, ADR-0018)

- Сессия — HttpOnly-cookie на том же origin (`__Host-sid` для web, `__Host-op_sid` для admin);
  фронтенд не хранит токены и не изобретает свою схему.
- Права приходят в профиле сессии (`GET /api/v1/sessions/current`) строками каталога
  `модуль:действие` и используются **только** чтобы скрыть или отключить элементы UI; решения
  принимает сервер. Поля себестоимости без `finance:view-cost` в ответе отсутствуют — UI не
  должен на них рассчитывать.
- Сессия «от имени» — только просмотр: постоянный баннер, действия изменения скрыты.

## 7. Тесты (ADR-0009)

- Unit и компоненты — Jest (стандарт Nx) + Testing Library; Vitest не используется.
- e2e — Playwright (`web-e2e`, `admin-e2e`), доступность — `@axe-core/playwright` на ключевых
  экранах (вход, касса скан → оплата, приёмка, возврат) и `jest-axe` для компонентов `libs/ui`;
  гейт — 0 нарушений serious/critical.
- Обязательно: мапперы и валидация, редьюсер чека, буфер перебоев (`fake-indexeddb`), каждый
  компонент — рендер + основной сценарий. Тестируется поведение, а не детали реализации.
- Пороги покрытия: `apps/web` буфер, мапперы, валидация — 80/70; `apps/*` global — 60/50;
  `libs/ui` — 70/60.

## 8. Нейминг

- Идентификаторы и комментарии — на английском. Компоненты — PascalCase, файл = имя компонента
  (`ReceiptPanel.tsx`); хуки — `useXxx`; срезы и сегменты — kebab-case (`receipt-view`).
- REST-пути — `/api/v1/…`, kebab-case, множественное число.

## 9. Логи и ошибки

- Каждый запрос к API несёт `X-Correlation-Id` (клиент API).
- ПДн, данные рецептов, тела ответов, секреты — никогда в `console`, в тексты ошибок и во
  внешние сервисы (аналитика, RUM, error tracking не подключаются без ADR).
- Ошибки не глотаются: error boundary на уровне приложения и явная обработка в месте вызова с
  понятным пользователю сообщением.

## 10. Запреты

- Самописная криптография (Web Crypto — стандартные примитивы, как AES-GCM буфера ПКУ).
- Внешние вызовы — только `apps/api`; новые интеграции, библиотеки уровня фреймворка, UI-киты —
  через ADR (`/03-adr`).
- Секреты — не в коде; конфигурация — `.env.local` (в `.gitignore`), в git — `.env.example`.

## 11. Перед PR

```bash
npx nx affected -t lint fsd test build    # затронутые проекты
npm run check                             # полный прогон: lint + fsd + test + build
```

PR — по правилам `CLAUDE.md` (ветка `feature/<task-id>-<slug>`, Conventional Commits, ревью
человеком, метка `ai-assisted`). CI — GitHub Actions по ADR-0009; пока workflow-файлов нет,
прогон ручной.
