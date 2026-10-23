<!-- based on /04 output (docs/architecture/generated/CLAUDE.pharmacy-app.md), merged per ADR-0010 -->
<!-- ai-project-start version: 0.2.2 | governance: ADR-0011 (outside the bank) -->

# CLAUDE.md — Pharmacy (SaaS-платформа автоматизации сети аптек)

Единый репозиторий (ADR-0010): архитектурные артефакты (`docs/architecture/`) и
Nx-монорепо кода (`apps/`, `libs/`) в корне. Общение с пользователем и командой — на русском;
идентификаторы и комментарии в коде — на английском.

Project class: Full

## Правила

1. **Новое архитектурное решение → сначала ADR** (`/03-adr`, `docs/architecture/adr/`), потом код:
   смена/добавление технологии или библиотеки уровня фреймворка, новая интеграция, новый
   компонент, изменение границ модулей. ADR может идти в том же PR, но принимается до слияния кода.
   ADR в статусе `proposed` — ещё не решение: реализовывать нельзя.
2. **Ревью архитектуры и принятие ADR** (`proposed` → `accepted`) — архитектор проекта
   Zohid Saidov (docs/architecture/APPROVAL.md). Внешних согласований нет (ADR-0011).
   Технология не из stack.md/accepted ADR — сначала ADR, никогда молча.
3. **Обязательные правила проекта (ADR-0011):**
   - никакой самописной криптографии — только проверенные библиотеки и алгоритмы;
   - персональные и клиентские данные не отправляются во внешние LLM и SaaS;
   - никаких внешних SaaS-БД для данных тенантов — только собственная PostgreSQL;
   - закрытый список интеграций (раздел «Integrations»); новая — через ADR.
4. Изменения stack.md / C4, меняющие принятую архитектуру, — через ADR и ревью архитектора
   (отметка в APPROVAL.md).

## Fixed technology stack (do not deviate)

| Слой | Технология | Статус |
|---|---|---|
| Backend | NestJS (Express adapter), TypeScript strict | ADR-0003 |
| Frontend (web, admin) | Next.js (React, TypeScript), **static export (SPA)** | ADR-0004 |
| БД | PostgreSQL | ADR-0001 |
| Кэш / сессии | Redis, клиент `redis` (node-redis): серверные сессии (запись по `jti`), версия прав, лимиты входа и throttler; на офлайн-точке Redis нет — сессии в PostgreSQL | ADR-0001, ADR-0008 |
| API-стиль | REST | ADR-0001 |
| Аутентификация | Самописная: логин+пароль, PIN терминала; scrypt из `node:crypto`; токен — JWT (`@nestjs/jwt`, HS256) в HttpOnly-cookie `__Host-sid` **с проверкой серверной сессии** (Redis; офлайн — PostgreSQL); контекст запроса строит `SessionMiddleware`, guard'ы только решают; вход «от имени» не реализуется (решение пересматривается) | ADR-0001, ADR-0008 |
| Авторизация | RBAC: динамические роли тенанта, каталог прав `модуль:действие` (`libs/shared/domain`), одна роль + охват точек, запрет эскалации, проверка только на сервере | ADR-0018 |
| Архитектура фронтенда | Feature-Sliced Design в `apps/web` и `apps/admin` («pages first», Steiger) | ADR-0017 |
| Фронтенд-библиотеки | TanStack Query, Zustand, React Hook Form + zod, use-intl, idb, uuid; свои: API-клиент, Service Worker, сканер, чтение xlsx/csv | ADR-0015 |
| UI и стили (web, admin, libs/ui) | Tailwind CSS v4 поверх токенов `--ph-*`; собственный кит `libs/ui` без UI-зависимостей | ADR-0007 |
| Доступ к данным / миграции | Kysely + `pg` (CamelCasePlugin), SQL-миграции node-pg-migrate (только Up) | ADR-0006 |
| Контейнеризация | Docker (офлайн-дистрибутив, test/prod, локальная среда) | ADR-0005 |
| Reverse proxy и статика | Caddy 2.11 (`docker/proxy`): TLS, статика web/admin в образе `pharmacy/proxy`, `/api` на тот же origin | ADR-0012 |
| Хостинг (пилот) | Один VPS Contabo (EU), домен `nurmed.online`; копии БД вне хоста — `age` + `rclone` | ADR-0020 |
| Организация кода | Nx-монорепо, единый репозиторий | ADR-0002, ADR-0010 |
| Runtime / тесты | Node.js 22 LTS (≥ 22.20) или 24 LTS (`.nvmrc` — 24, Docker — 24), npm, Jest; e2e фронтенда — Playwright | ADR-0008, ADR-0009 |
| CI | GitHub Actions | ADR-0009 |
| Резервное копирование БД | Ежедневный `pg_dump` с проверкой восстановления: сервис `backup` (test, prod) на образе `pharmacy/postgres`, роль `pharmacy_backup` | ADR-0019 |

**Ещё не решено — ADR в статусе `proposed`, до `accepted` не использовать:** на `main` таких нет.

## Architecture references

- Профиль и стек: docs/architecture/stack.md
- C4: docs/architecture/c4/ (context, container, deployment + PNG в img/)
- Глоссарий домена: docs/architecture/glossary.md — термины кода (tenant, store, batch,
  stock movement, receipt, shift…) берутся оттуда, не изобретаются
- Решения: docs/architecture/adr/ · Апрув ревью: docs/architecture/APPROVAL.md
- Исходный вывод /04: docs/architecture/generated/CLAUDE.pharmacy-app.md (исторический; действует этот файл)
- Архив bootstrap-инструкций: docs/architecture/bootstrap-claude-md.bak
- Исходные ТЗ: «Клиентский продукт» v3.1, «Административный продукт» v2.1,
  «Бэклог MVP и модель данных» v1.1 (хранятся у команды)

## Project structure

```
pharmacy/
├── apps/
│   ├── api/          # NestJS: модульный монолит — src/app/{stores, staff, catalog, inventory,
│   │                 #   pos, purchasing, pricing, returns, notifications, reports, billing, sync, fiscal,
│   │                 #   export-1c, audit}
│   ├── api-e2e/      # e2e-тесты API (Jest)
│   ├── web/          # Next.js: клиентский продукт (касса, склад, кабинет владельца)
│   │                 #   app/ — маршруты (реэкспорты), pages/ — пустая; src/{app,pages,widgets,features,entities,shared} — FSD (ADR-0017)
│   └── admin/        # Next.js: админка оператора платформы — та же структура FSD
│   ├── web-e2e/      # e2e web (Playwright + axe): сборка out/ + фейковый /api/v1; admin-e2e — позже
├── libs/
│   ├── shared/dto/     # @pharmacy/shared-dto — DTO и контракты REST API (единственный источник типов API)
│   ├── shared/domain/  # @pharmacy/shared-domain — Tenant, Store, Batch, Receipt, StockMovement…
│   ├── shared/util/    # @pharmacy/shared-util — деньги (integer дирамы), даты, i18n RU/TJ
│   └── ui/             # @pharmacy/ui — общий UI-кит web и admin (сенсорные экраны от 10″)
├── docker/           # compose.yml (+ compose.backup.yml для test/prod) + образы postgres/, redis/, proxy/ (Caddy + статика, ADR-0012); apps/api/Dockerfile
├── docs/architecture/, templates/   # архитектура, ADR; шаблоны ai-project-start
└── nx.json / package.json / tsconfig.base.json / eslint.config.mjs
```

Границы модулей (`@nx/enforce-module-boundaries`, теги в `package.json` → `nx.tags`):
- apps (`type:app`) не импортируют друг друга — только libs;
- `type:domain` не зависит ни от чего прикладного; `scope:api` не импортирует `type:ui`;
- модули api общаются через публичные интерфейсы (`exports`) модулей, не через чужие внутренности;
  граф без циклов: `catalog` ← `pricing`; `catalog` ← `purchasing` (`ProductsReader`); `catalog`, `pricing`,
  `purchasing` ← `inventory` (`ProductsReader`, `StorePriceWriter`, `SuppliersReader`, `SupplierLedger`,
  `OrderReceiving`); `catalog`, `pricing`, `inventory` ← `pos` (`ProductsReader`, `StorePricesReader`, `PosStock`,
  `Numbering`).
  `pos`, `inventory`, `catalog` ← `returns` (`SoldReceipts`, `PosShifts`, `PosContext`, `PosIdempotency`,
  `ReturnStock`, `Numbering`, `ProductsReader`); итоги возвратов смены и
  номера возвратов `pos` и `inventory` получают через порты `ShiftReturns`, `CustomerReturnNumbers`, которые
  заполняет `returns`.
  `pos`, `returns`, `inventory`, `purchasing` ← `notifications` ← `reports` (`SalesFigures`, `PosAlerts`,
  `ReturnFigures`, `StockAlerts`, `SupplierDues`, `Reminders`); `audit` ← все (`AuditService`, журнал `AuditJournal`);
  цену последнего прихода `pricing` получает через порт `PurchasePrices`, который заполняет `inventory`, а
  остатки точек (проблема «нет цены») — через порт `StockedProducts`, который тоже заполняет `inventory`;
  `inventory`, `pricing` ← `reports` (счётчики меню: `StockAlerts`, `PriceProblems`).
  Прочие расходы — своя таблица модуля `reports`; изъятия кассы «на расходы» он получает через `SalesFigures`.
  `inventory`, `pos`, `purchasing`, `terminals`, `pricing` ← `stores` (закрытие точки: `StoreClosingTransfers`,
  `TransferAcceptance`, `PosShifts`, `SupplierDues`, `TerminalsService`, `StoreDiscountDetachment`); о приёмке
  перемещения `inventory` сообщает через порт `TransferAcceptance`, который заполняет `stores`.
  `billing` ← `notifications` (`ServiceDecisions` — решения оператора по услугам сети, `OverdueInvoices` —
  просроченные счета сети); платформенная часть биллинга — `app/platform/billing`, ей `billing` отдаёт
  `StoreUsage` (активность точек за месяц для счетов, в контексте сети).
  Дашборд и статистика админки — `app/platform/stats`: `pos` отдаёт ему `StoreSalesExport` (пересчёт витрин
  статистики сети в её контексте), `platform/billing` — `BillingOverview` (просроченные счета, последний
  выставленный месяц, заявки без решения).
  Уведомления оператора и счётчики меню админки — `app/platform/notifications`: состояния берёт у `platform/stats`
  (`OperatorQueue` — общий источник с очередью дашборда), число заявок — у `platform/billing` (`BillingOverview`).
  Синхронизация офлайн-точек (ADR-0014): `pos`, `returns`, `terminals`, `audit`, `catalog`, `pricing`, `inventory`
  регистрируют применители фактов точки в реестре ядра `SyncAppliers` (`core/sync`, глобальный); облачный модуль `sync`
  (контур `/api/v1/sync/*` по лицензионному ключу точки) применяет операции через реестр и читает остатки точки через
  `StockFacts` (`inventory` ← `sync`). Розницу из документов точки `inventory` применяет по правилу локальной цены
  `LocalPriceRule` (экспорт `pricing`), долг поставщику и статус заказа — через `SupplierLedger` и `OrderReceiving`.
  Лента «облако → точка» (E4, E5): писатели справочников записывают изменение через порт ядра `SyncChanges` в своей
  транзакции (у `catalog`, `pricing` — в репозиториях), а текущее состояние сущностей отдают их источники в реестре
  ядра `SyncFeedSources` (`CatalogFeed`, `PricingFeed`); модуль `sync` нумерует и выдаёт ленту (`GET /sync/changes`).
  Очистка данных рецептов по сроку (касса PR 3, ADR-0013, поправка 2026-10-21) — `app/platform/retention`: раз в час
  «по тенанту в цикле» вызывает `PrescriptionRetention` (экспорт `pos`) и `InboxRetention` (экспорт `sync`); кто держал
  терминал в момент операции под терминалом, `pos` узнаёт у `audit` (`PinSignIns`).
  Загрузка данных из файла (спецификация 2026-10-20-data-import): каталог, начальные остатки и поставщиков загружают
  их модули (`catalog`, `inventory`, `purchasing`); общий журнал загрузок `ImportJobs` (`core/imports`, глобальный) —
  очередь загрузок сети, повтор по ключу, прошлые загрузки тех же строк.

## Build / test / lint

```
npm ci                               # установка строго по lock-файлу
npx nx run-many -t build test lint fsd   # всё (= npm run check)
npx nx affected -t build test lint fsd   # только затронутое изменением
npx nx fsd web / admin               # Steiger — слои FSD (ADR-0017)
npx nx serve api                     # http://localhost:3000/api/v1/health
npx nx dev web                       # http://localhost:4200 (/api/* проксируется на :3000, только dev)
npx nx run web:dev-api               # то же, но готовые маршруты (вход, точки, сотрудники, роли, каталог, цены, скидки,
                                     #   поставщики и оплаты, заказы поставщикам, приход, начальные остатки, списание,
                                     #   инвентаризация, возврат поставщику, перемещения и заявки, остатки,
                                     #   касса и смена, возвраты покупателей, главная, уведомления,
                                     #   журнал действий, настройки сети, отчёты, расходы, закрытие точки,
                                     #   услуги, счётчики меню, оплата и печать счёта, объявления платформы,
                                     #   загрузка из файла: каталог, начальные остатки, поставщики) — в apps/api
npx nx dev admin                     # http://localhost:4300 (все запросы — в моки)
npx nx run admin:dev-api             # то же, но готовые маршруты (вход оператора, сети, журнал операторов,
                                     #   команда и профиль, настройки платформы, услуги, счета, платежи,
                                     #   скидки, печать счёта, дашборд, статистика, уведомления, объявления) — в apps/api
npx nx e2e api-e2e                   # e2e API (поднимает api сам; БД из .env должна быть мигрирована: api:migrate)
npx nx e2e web-e2e                   # e2e web: собирает web, браузеры — установленные Chrome/Edge
npx nx run api:migrate               # миграции dev-БД ролью pharmacy_owner (нужен npm run dev:deps)
npx nx run api:integration           # интеграционные тесты на БД pharmacy_test (нужен npm run dev:deps)
npx nx run api:db-types              # перегенерация типов Kysely из мигрированной БД; db-types-verify — проверка актуальности

npm run dev:deps                     # PostgreSQL + Redis в Docker (dev), затем npm run dev
npm run dev                          # api + web + admin с hot reload
```

Задачи Nx запускать через `npx nx …`, а не напрямую инструментами. Флаги генераторов не угадывать —
`npx nx g <plugin>:<generator> --help`. Новые проекты — генераторами Nx (`/scaffold-nestjs-api`
для API), не `nest new` / `create-next-app`.

## Conventions

- TypeScript strict везде.
- REST: `/api/v1/…`, ресурсы во множественном числе (kebab-case), JSON camelCase;
  пагинация limit/offset; ошибки — RFC 7807 (application/problem+json).
- Единственная валюта — сомони (TJS, ADR-0016): продажи, закупки, долги, счета; курсов и валютных полей нет.
- Деньги — integer в дирамах (minor units), никакого float; округление себестоимости штуки
  при делении упаковки — вверх, в пользу аптеки (правило ТЗ).
- Мультитенантность: tenant_id обязателен во всех прикладных таблицах и запросах; доступ к
  данным — только через слой, применяющий фильтр тенанта (ADR-0002).
  Кросс-тенантный доступ (оператор, фоновые задачи) — только по ADR-0013: роль `pharmacy_platform`
  без BYPASSRLS в `app/platform/**`, резолверы SECURITY DEFINER, задачи «по тенанту в цикле»;
  класс каждой таблицы — в манифесте `table-classes.ts`.
- Остатки не хранятся — выводятся из движений по партиям; складская операция/чек и её
  движения — в одной транзакции БД.
- Офлайн-точка (ADR-0014): складские операции и чеки точки проводятся только на точке; операция
  синхронизации пишется в `sync_outbox` в той же транзакции, что и факт, и досылается в облако
  идемпотентно. Заказы, оплаты поставщикам и заявки на перемещение ведутся только в облаке; отмена
  проведения на офлайн-точке запрещена.
- Аудит и журнал ПКУ — append-only (без UPDATE/DELETE на уровне БД).
- Миграции БД — версионированные (инструмент — ADR-0006); никакого schema-sync в проде.
- NestJS: один модуль = один домен; DTO с class-validator в libs/shared/dto; без бизнес-логики
  в контроллерах.
- Next.js: `output: 'export'` — без SSR/ISR, Server Actions, Route Handlers и middleware; маршруты
  статические, id и фильтры — в query-параметрах; данные только через apps/api — свой клиент на
  `fetch` с типами `import type` из `@pharmacy/shared-dto` (ADR-0015).
- Касса офлайн-устойчива (ADR-0015): outbox-first — операция с UUIDv7-ключом идемпотентности сначала
  пишется в IndexedDB (`idb`), затем досылается; ни одна операция не удаляется молча (карантин).
  Service Worker — свой минимальный, только в облачной сборке `apps/web`. Пределы буфера — параметры сети
  (24 ч / 500 операций, ПКУ без связи — 8 ч / 20 чеков), касса знает их из снимка каталога; без сессии буфер
  досылается под терминалом (device-cookie, автор держал терминал в момент операции — ADR-0008, поправка
  2026-10-21), в том числе с экрана входа после перезагрузки.
- Commits: Conventional Commits.

## Claude Code: скилы, агенты, команды

Адаптированы под этот стек (MIT, .claude/THIRD_PARTY_NOTICES.md). Загружать до написания кода:

| Задача | Скил / агент |
|---|---|
| Модули, контроллеры, сервисы, DTO, guards, тесты apps/api | скил `nestjs-api`; агент `nestjs-api`, ревью — `nestjs-reviewer` |
| SQL, схема, миграции, запросы | скил `postgres-best-practices`; ревью — `postgresql-database-reviewer` |
| React-код web/admin/ui | скил `react-dev` |
| Токены, доступность, печать чеков | скил `ui-standards-tokens`; ревью — `ui-standards-expert` |
| Tailwind-утилиты (ADR-0007) | скил `tailwind-patterns` |
| Производительность фронтенда, касса | скил `web-performance-optimization` |
| Новое приложение API | команда `/scaffold-nestjs-api` |
| Архитектурное решение | команда `/03-adr` |

## Git / pull requests (GitHub `zohidweb/pharmacy`)

- Branch naming: `feature/<task-id>-<slug>` or `fix/<task-id>-<slug>`, from an up-to-date `main`.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Direct pushes to `main` are forbidden — every change goes through a pull request.
- A pull request requires at least one approve from a human developer of the team; an AI is
  never the reviewer of record.
- The PR description states what was done, links the ADR when an architectural decision is
  involved, and how it was verified (tests run, manual checks). AI-assisted PRs are labeled `ai-assisted`.

## Definition of Done

- Build, test, and lint from "Build / test / lint" pass.
- New logic is covered by tests.
- Docs/ADR are updated when architecture changed.
- Human review has passed.
- No TODOs or stubs without a tracked ticket.
- No secrets or real client data in the diff.

## Reviewing AI-generated code (checklist)

The reviewer is a human developer of the team — never an AI. Before approving, verify:
- The code matches the "Fixed technology stack" — no undeclared languages, frameworks, or
  libraries; nothing from `proposed` ADRs.
- External calls go only to systems in the "Integrations" list.
- No secrets or client data anywhere in the diff.
- No self-made cryptography; password hashing only with the approach approved in ADR-0008 (scrypt via `node:crypto`).
- Financial operations carry idempotency and a correlation ID.
- Error handling does not silently swallow failures.
- tenant_id filtering present in every data access path (multi-tenancy isolation).

## Integrations (closed list)

Only these. Financial operations require idempotency and a correlation ID.

| Система | Протокол | Формат |
|---|---|---|
| 1С:Бухгалтерия 8 (Таджикистан) | Файловый обмен, выгрузка вручную за период | CommerceML/XML |
| Фискализация (онлайн-ККМ) | Адаптер отправки чека; в MVP — заглушка | По требованиям вендора (не выбран, вопрос № 9 stack.md) |
| Синхронизация офлайн-точек | HTTPS + лицензионный ключ точки, идемпотентная очередь | JSON |

Эквайринг (оплата картой) — БЕЗ интеграции: кассир проводит оплату на платёжном терминале вручную. Новая интеграция = сначала новый ADR.

## Environments

| Среда | Env-файл (не в git) | Compose-проект | Вход (proxy) | API напрямую | PostgreSQL / Redis наружу |
|---|---|---|---|---|---|
| dev | `.env` ← `.env.example` | `pharmacy-dev` | нет — `next dev` на 4200/4300 | `127.0.0.1:3000` | `5432` / `6379` на localhost |
| test | `docker/env/test.env` | `pharmacy-test` | `https://pharmacy-test.localhost:8443`, `https://admin.pharmacy-test.localhost:8443` | `127.0.0.1:3100` (диагностика) | PostgreSQL `127.0.0.1:5433` (по TCP — только роли API), Redis — нет |
| prod | `docker/env/prod.env` | `pharmacy-prod` | `https://app.nurmed.online`, `https://admin.nurmed.online` (VPS, ADR-0020) | нет | нет (только сеть compose, C4) |

```
npm run stack -- <dev|test|prod> <init|build|up|down|ps|logs> [service…] [--skip-checks]
npm run stack -- <test|prod> <backup|backup-status|backup-verify <копия>|restore <копия> [--replace-database]>
npm run stack -- test init     # env-файл из примера со случайными паролями (один раз)
npm run test-env:build         # lint + test + образы с тегом <git sha> (web/admin собирает образ proxy)
npm run test-env:up            # запуск и ожидание healthy;  test-env:down — остановка
npm run prod:build / prod:up / prod:down
```

- Скрипт: `tools/scripts/stack.mjs`; compose: `docker/compose.yml` + `docker/compose.<env>.yml` (+ `compose.backup.yml`
  в test и prod — без него compose отказывает: `backup` в `compose.<env>.yml` только дополняется). Образы `pharmacy/*`
  собираются локально и никогда не скачиваются (`pull_policy: never`): неверный `IMAGE_TAG` — ошибка, а не чужой
  образ с Docker Hub.
- `build` — ручной quality gate, пока workflow-файлы CI не созданы (ADR-0009): lint + test всех
  проектов, затем сборка. Для prod `--skip-checks` запрещён, а сборка — только из чистого дерева
  git (тег образа = короткий sha; у test с незакоммиченными изменениями — `<sha>-dirty`).
- `up` для test/prod запускает ровно те образы, что собрал `build` (`--no-build`).
- `build` собирает web/admin без моков API: `NEXT_PUBLIC_API_MOCKS=false` закреплён, переменная — вход кэша Nx
  (сборка с моками не восстанавливается из кэша), а бандл, в котором остались моки, останавливает сборку
  (`tools/scripts/frontend-mocks.mjs`; ревью безопасности 2026-10-22, F1). Ответы API — с `Cache-Control: no-store`
  и без ETag (P1).
- Env-файлы сред лежат в `docker/env/`, а не `.env.test`: Nx автоматически грузит `.env.<имя>`
  в задачи (`.env.test` попал бы в `nx test`). В корневом `.env` не задавать `NODE_ENV`.
- `APP_ENV` (dev|test|prod) — среда развёртывания; `NODE_ENV` в test/prod всегда `production`.
- В env-файлах сред обязательны `PHARMACY_OWNER_PASSWORD`, `PHARMACY_APP_PASSWORD` и `PHARMACY_PLATFORM_PASSWORD`.
  Пароли подставляются в URL подключения compose: символы `@ / : ? #` в пароле, заданном вручную,
  ломают URL — `stack init` генерирует безопасные (base64url).
  Роли создаёт initdb только на пустом томе: существующие тома (`pharmacy-<env>_pg-data`) после появления
  новых ролей нужно пересоздать (`docker volume rm`, данные теряются — только для test/dev).
- Вход в test/prod — только через proxy (Caddy, ADR-0012); `PROXY_PROFILE` (`cloud` | `local` | `offline`) и
  `TLS_MODE` (`acme` | `internal` | `files` | `off`) выбирают схему, адреса — `WEB_ADDR`, `ADMIN_ADDR`, `APEX_ADDR`.
  `WEB_ORIGIN`/`ADMIN_ORIGIN` (проверка `Origin` в API) должны совпадать с адресами proxy, `TRUST_PROXY=1`.
  `OPERATOR_ALLOW` обязателен: в test — `private_ranges` (локально клиенты приходят из сети Docker; на общем стенде —
  адреса тестировщиков), в prod — публичные IP офисов операторов или VPN.
  В env-файле, созданном до proxy, `stack init` допишет новые переменные (и `TRUST_PROXY=1` — закомментированная строка
  не считается), но старые `WEB_ORIGIN`/`ADMIN_ORIGIN` нужно поправить вручную.
- test локально: HTTPS на `*.localhost` с локальным УЦ Caddy (`tls internal`). Корневой сертификат тома
  `pharmacy-test_proxy-data` доверить один раз (иначе браузер не примет cookie `__Host-*`):
  `docker compose --project-name pharmacy-test --env-file docker/env/test.env -f docker/compose.yml -f docker/compose.test.yml -f docker/compose.backup.yml cp proxy:/data/caddy/pki/authorities/local/root.crt caddy-test-root.crt`,
  затем `certutil -addstore -user Root caddy-test-root.crt` (Windows, текущий пользователь); файл после этого удалить.
- prod — VPS Contabo по ADR-0020: DNS A-записи `app.`, `admin.` и apex `nurmed.online` на IP сервера и открытый 80-й
  порт до первого старта (Let's Encrypt), `ACME_EMAIL` обязателен; том `pharmacy-prod_proxy-data` хранит ключ
  ACME-аккаунта и сертификаты. Выкладка до ADR о CD — `docs/guides/deploy-vps.md`.
- **Бэкапы** (ADR-0019, спецификация `docs/superpowers/specs/2026-10-21-db-backups-design.md`) — только test и prod:
  - сервис `backup` (`docker/compose.backup.yml`, `stack.mjs` добавляет его сам) каждую ночь в `BACKUP_TIME`
    (02:00, Душанбе) делает `pg_dump` и проверяет копию восстановлением во временный экземпляр; непроверенная копия
    копией не считается. После неудачи — повтор через час (дамп неудачной копии удаляется); если ночная копия пропущена или
    оборвана перезапуском — копия сразу при старте контейнера;
  - копии — в `BACKUP_DIR` на хосте: отдельный диск или сетевой том, не диск данных Docker (на Linux каталог создаётся
    так: `sudo install -d -o 70 -g 70 -m 700 <dir>`); хранятся `BACKUP_RETENTION_DAYS` (30, у test — 7), самая
    свежая проверенная — всегда. Переменные добавляет `stack init`;
  - мониторинга нет: оператор каждый день смотрит `npm run stack -- <env> ps` (`backup` unhealthy — проверенной копии
    нет 26 ч, каталог недоступен или сработала защита пустой базы) и `backup-status` (копии, длительность
    копирования и восстановления — оценка RTO, следующий запуск, причина блокировки);
  - восстановление: `restore <копия>` без флага только показывает план; с `--replace-database` останавливает `api`
    и `backup`, восстанавливает копию рядом (`pharmacy_restore`), меняет имена (прежняя база остаётся как
    `pharmacy_before_<копия>`, без подключений, удаляется вручную — команду печатает `restore`), перезапускает Redis
    (все входят заново) и поднимает стек; `migrate` догоняет миграции, вышедшие после копии;
  - потеря диска: восстановить env-файл из его копии → `up postgres` → `backup-status` → `restore <копия>
    --replace-database`. Если сразу сделали полный `up`, защита пустой базы не даст копировать пустую базу поверх
    истории копий;
  - env-файл (ключи JWT, pepper, пароли) в копии не входит и хранится отдельно (ADR-0008): без того же pepper
    пароли и PIN восстановленной базы недействительны. Redis не копируется;
  - в окне копии не выкладывать и не запускать миграции вручную: `pg_dump` держит блокировки до конца, а
    `lock_timeout` есть не у всех миграций. `stack up` с новым тегом перезапускает `postgres` и обрывает копию — новый
    `backup` сделает её сразу после `migrate`;
  - копия за пределы хоста и шифрование копий — по ADR-0020 (`age` + `rclone` в Object Storage другого региона), до
    prod; ещё не сделаны.

## Containers (ADR-0005)

- Образы: `apps/api/Dockerfile` (multi-stage, `nx run api:prune`, non-root; код принадлежит root, без source map и
  npm), `docker/postgres`
  (роли `pharmacy_owner` / `pharmacy_app` / `pharmacy_platform` / `pharmacy_resolver` / `pharmacy_provisioner`, схема
  `pharmacy`, `pg_trgm`; скрипт копий `pharmacy-backup`, ADR-0019), `docker/redis` (без персистентности). Контекст сборки — корень репозитория
  (`.dockerignore`).
- Роли БД (ADR-0006, ADR-0013): база принадлежит `pharmacy_owner`. API в рантайме подключается ролями
  `pharmacy_app` (tenant-путь, `DATABASE_URL`) и `pharmacy_platform` (только `app/platform/**` и
  `app/sync/**`, `PLATFORM_DATABASE_URL`); `pharmacy_resolver` — NOLOGIN (владелец резолверов SECURITY DEFINER,
  только чтение); `pharmacy_provisioner` — NOLOGIN (владелец функций создания сети `provision_tenant` /
  `issue_owner_code`, ADR-0013, поправка 2026-10-05). На кластере, созданном до поправки, роль добавляется
  один раз суперпользователем: `docker/postgres/initdb/03-provisioner-role.sql` (команда — в его шапке).
  `pharmacy_owner` используется только сервисом `migrate`; `PHARMACY_OWNER_PASSWORD` не передаётся в `api`.
  В test и prod PostgreSQL берёт правила входа из `docker/postgres/pg_hba.conf` (ревью безопасности 2026-10-22, Z6):
  по TCP входят только `pharmacy_app` и `pharmacy_platform`. Суперпользователь, `pharmacy_owner` (`migrate`) и
  `pharmacy_backup` (`backup`) — только через локальный сокет: том `pg-socket` общий у `postgres`, `migrate` и
  `backup`, но не у `api`; `migrate` и `backup` подключают его только для чтения: `backup` работает с uid сервера и
  иначе мог бы подменить сокет. Вход по сокету тоже с паролем; в контейнере `postgres` его даёт `PGPASSWORD`, поэтому
  `docker compose exec postgres psql -U <суперпользователь>` работает без ввода. В dev правила образа прежние.
  - Раньше суперпользователь входил по сокету без пароля, и его пароль в базе мог разойтись с
    `POSTGRES_SUPERUSER_PASSWORD` env-файла. Поэтому перед первой выкладкой этих правил на существующий кластер его
    нужно проверить (ответ `1`):
    `docker compose --project-name pharmacy-<env> --env-file docker/env/<env>.env -f docker/compose.yml -f
    docker/compose.<env>.yml -f docker/compose.backup.yml exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$(hostname -i)" -U
    "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select 1"'`.
  - Если пароль разошёлся и `up` уже упал:
    1. в контейнере `postgres` выполнить
       `sed -i '1i local all <суперпользователь> trust' /etc/pharmacy/pg_hba.conf && kill -HUP 1`;
    2. задать пароль через `alter role … password …`;
    3. вернуть файл образа: `up -d --force-recreate postgres`.
  - Пароль `pharmacy_backup` остаётся в окружении `postgres` для `04-backup-role.sql` (вторая половина Z6 не
    сделана). Тот же контейнер и так держит пароль суперпользователя.
  `pharmacy_backup` (ADR-0019) — LOGIN, BYPASSRLS, член `pg_read_all_data`, не суперпользователь: только сервис
  `backup` (test, prod), пароль `PHARMACY_BACKUP_PASSWORD`. Роль создаёт или обновляет идемпотентный
  `docker/postgres/initdb/04-backup-role.sql` — при initdb и при каждом `stack <test|prod> up` до старта остальных
  сервисов, поэтому новая роль и смена пароля в env-файле ручных шагов не требуют.
- Миграции: одноразовый сервис `migrate` (тот же образ `pharmacy/api`, `node scripts/migrate.mjs`) применяет
  SQL-миграции ролью `pharmacy_owner` до старта API (`api` ждёт `service_completed_successfully`). Скрипт и
  `migrations/` попадают в образ через assets webpack. Если API не стартует из-за миграции —
  `npm run stack -- <env> logs migrate`.
- Proxy: `docker/proxy/Dockerfile` (стадия node собирает web и admin без моков и предсжимает их
  `tools/scripts/precompress.mjs`, `*.map` удаляются; стадия `caddy:2.11.7-alpine` по digest), `Caddyfile` и профили
  `docker/proxy/profiles/`. На `app.` — статика web и весь `/api`, кроме `/api/v1/operator/*` (404); на `admin.` — статика
  admin и только `/api/v1/operator/*` — и то лишь адресам `OPERATOR_ALLOW` (CIDR через пробел: офисы операторов, VPN;
  по адресу соединения, без `X-Forwarded-For`), остальным 403 (ревью безопасности 2026-10-22, A1; поправка ADR-0012
  2026-10-23). Лимиты тела (MiB, как в API): `/api` 1, `/api/v1/sync/*` 4, загрузки `*-imports` 10; сжатое тело
  (`Content-Encoding`) вне sync — 415; ответы `/api` — `Cache-Control: no-store` (эшелоны к A3 и P1 в API).
  Без SPA-fallback: маршрут — свой HTML, неизвестный путь — `404.html` со статусом 404. HSTS ставит только proxy
  (`acme`/`files`), helmet API его не шлёт. В dev proxy не запускается (compose-профиль `proxy`). Образ сначала собирает
  декларации библиотек (`typecheck`): `next build` проверяет типы по `libs/*/dist`, а в контексте сборки их нет.
- `TRUST_PROXY` (число reverse proxy перед API, 0–5, по умолчанию 0 = выключено; в env-примерах test и prod — 1)
  — обязательная часть выкладки за reverse proxy ADR-0012: без него `req.ip` — адрес
  прокси, и лимиты по IP (гостевой, входа, активации) становятся одним общим лимитом платформы, а адрес в
  аудите входа — адресом прокси. Значение должно равняться реальному числу прокси: завышенное позволяет
  клиенту подделать `X-Forwarded-For`. Не новая технология, ADR не нужен (stack.md, вопрос № 13).
  С `APP_ENV=prod` облачный API (`STORE_MODE=cloud`) не стартует при `TRUST_PROXY=0` и `http://` в `WEB_ORIGIN` /
  `ADMIN_ORIGIN` (ревью безопасности 2026-10-22, A7, решение 7.2). В `prod.env`, созданном раньше, строка
  `# TRUST_PROXY=0` закомментирована: `npm run stack -- prod init` допишет `TRUST_PROXY=1`, иначе `api` не поднимется
  (причина — в `logs api`).
- `stack build/up/restore` в test и prod отказывают, если в env-файле нет переменной с заглушкой в примере, остались
  `change-me` / `generate-key` или пароль короче 16 символов (S2; файл читается как его читает compose). Заменять
  только названные переменные: на базе с данными новый пароль роли нужно ещё задать `ALTER ROLE … PASSWORD`
  суперпользователем (в test можно пересоздать том), а новый pepper обесценивает все пароли и PIN — новый env-файл от
  `init` годится только для нового стека.
- Первый код активации владельца (часть 1 аутентификации; выдаёт оператор, печатается один раз). В test/prod
  PostgreSQL доступен только в сети compose, поэтому скрипт запускается из образа `api`
  (`scripts/create-activation-code.mjs`, `DATABASE_URL` уже задан в сервисе `api`, срок —
  `ACTIVATION_CODE_TTL_HOURS`, по умолчанию 72 ч). Стек должен быть поднят (`npm run stack -- <env> up`):

  ```
  IMAGE_TAG=$(git rev-parse --short HEAD) docker compose --project-name pharmacy-<test|prod>     --env-file docker/env/<test|prod>.env -f docker/compose.yml -f docker/compose.<test|prod>.yml -f docker/compose.backup.yml     run --rm --no-deps api node scripts/create-activation-code.mjs --login <логин|телефон|e-mail>
  ```

  `IMAGE_TAG` — тег образа, собранного `build` (короткий sha; у test с незакоммиченными изменениями —
  `<sha>-dirty`). В PowerShell переменная задаётся отдельно: `$env:IMAGE_TAG = git rev-parse --short HEAD`, затем
  та же команда `docker compose …` без префикса. Сначала проверьте, что образ есть:
  `docker image inspect pharmacy/api:<тег>`. Без образа `run` не упадёт, а начнёт сборку (у сервиса `api` есть
  `build:`, флага `--no-build` у `run` нет) — и запустит код рабочего дерева, а не собранного `build`.
  В dev: `node --env-file=.env apps/api/scripts/create-activation-code.mjs --login …` (нужен `npm run dev:deps`). Скрипт печатает код и срок и больше ничего; ни код, ни хеш не логируются.
- Первый оператор платформы (часть 3 аутентификации) — тот же механизм: `scripts/create-operator.mjs
  --login <рабочий e-mail> --name "<ФИО>"` создаёт оператора (или находит существующего) и печатает
  одноразовый код один раз; пароль оператор задаёт сам на экране админки «Первый вход» (`/activate`,
  ссылка со страницы входа) — `POST /api/v1/operator/activations`.
  Скрипт работает ролью `pharmacy_platform` (`PLATFORM_DATABASE_URL`, задан в сервисе `api`) и пишет
  `platform_audit_log`. Запуск — как выше, с `node scripts/create-operator.mjs …`; в dev —
  `node --env-file=.env apps/api/scripts/create-operator.mjs --login … --name "…"`.
- Офлайн-точка (часть 4 аутентификации): `STORE_MODE=offline` и `OFFLINE_TENANT_ID=<сеть точки>`,
  Redis не нужен — сессии в таблице `sessions` PostgreSQL точки, лимиты попыток в памяти процесса,
  маршрутов оператора нет; модули `stores`, `staff`, `catalog`, `pricing`, `purchasing`, `inventory`, `pos`, `returns`,
  `notifications`, `reports`, `billing` пока
  регистрируются только в облаке (синхронизация на точку — ADR-0014, отдельной задачей). Ключи JWT и pepper точки
  генерируются на её ПК: `node scripts/generate-store-secrets.mjs --env-file <env-файл точки>`
  (значения не печатает, существующие не перезаписывает; бэкап pepper — отдельно от бэкапа БД).
  Дистрибутив точки (ADR-0005) — отдельной задачей.
- Контур синхронизации `/api/v1/sync/*` (облако) включается переменной `OFFLINE_SYNC_ENABLED=true`, по умолчанию
  выключен: офлайн-точек на пилоте нет (ревью безопасности 2026-10-22, решение 7.4). Без неё нет ни маршрутов, ни
  парсера тела sync в `main.ts`; модуль `SyncModule` (без маршрутов) остаётся для очистки конвертов. Для живых
  проверок синхронизации в dev задайте её в `.env`.
- Ключ офлайн-точки (спецификация 2026-10-16-offline-sync, E10–E15; до экранов админки — скриптами, ролью
  `pharmacy_platform`): `node --env-file=.env apps/api/scripts/issue-license-key.mjs --store <id> --valid-until
  <YYYY-MM-DD>` печатает `phk_<keyId>_<secret>` один раз (в БД — только SHA-256; ключ — в env-файл точки, не в git),
  действующий ключ точки при этом отзывается; `revoke-license-key.mjs --store <id>` — отзыв действующего ключа
  (облако ещё `revoked_key_grace_days` дней принимает операции точки); `--hard --key <keyId>` — названный ключ
  больше ничего не принимает (украденный ПК: сначала выдать новый ключ, затем `--hard` по старому; без `--key`
  скрипт только печатает ключи точки); `reapply-quarantine.mjs --store <id>`
  возвращает операции из карантина в очередь — облако переприменит их в конце следующего батча точки.
- Порты в compose публикуются только на `127.0.0.1`.
- Контейнеры `api`, `migrate` и `backup` работают только для чтения (`/tmp` — tmpfs), без Linux capabilities и с
  `no-new-privileges` (ревью безопасности 2026-10-22, S3). Скрипты базы через `run --rm api node scripts/…` (код
  активации, оператор, ключи точки, карантин) работают так же: они только читают файлы образа и подключаются к базе.
  `generate-store-secrets.mjs` пишет в env-файл и запускается на ПК точки, а не в контейнере. Dev-серверы web и admin
  слушают только `127.0.0.1` (S4).

## Local development secrets

- Never commit secrets (passwords, keys, connection strings, tokens) to git, in any form.
- Переменные аутентификации `SESSION_JWT_KEYS`, `SESSION_JWT_ACTIVE_KID`, `PASSWORD_PEPPERS`,
  `PASSWORD_PEPPER_ACTIVE` (а также `WEB_ORIGIN`, `ADMIN_ORIGIN`) обязательны: без них API не стартует, а
  `docker/compose.yml` не поднимает даже `npm run dev:deps`. Перенесите их из `.env.example` в `.env`;
  свои ключи — случайные 32 байта base64url. Команда заменяет в `.env` четыре строки ключей и ничего не
  печатает:

  ```
  node -e "const c=require('crypto'),f=require('fs'),k=()=>c.randomBytes(32).toString('base64url'),n=['SESSION_JWT_KEYS','SESSION_JWT_ACTIVE_KID','PASSWORD_PEPPERS','PASSWORD_PEPPER_ACTIVE'];const o=f.existsSync('.env')?f.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>!n.some(x=>l.startsWith(x+'='))):[];f.writeFileSync('.env',o.join('\n').replace(/\n+$/,'')+'\nSESSION_JWT_KEYS=k1:'+k()+'\nSESSION_JWT_ACTIVE_KID=k1\nPASSWORD_PEPPERS=1:'+k()+'\nPASSWORD_PEPPER_ACTIVE=1\n')"
  ```

  Для e2e (`npx nx e2e api-e2e`) в `.env` нужны ещё `DATABASE_URL`, `PLATFORM_DATABASE_URL`, `REDIS_URL`;
  `APP_ENV=test` и `AUTH_TEST_COOKIES=true` тест задаёт сам для запускаемого процесса API.
- `.env` (API, docker compose) и `.env.local` (frontend) — в `.gitignore`; в git только `.env.example`
  без реальных значений.
- Production secrets: хранилище секретов пока не выбрано — через ADR (вопрос № 8 в stack.md);
  до этого — env-файлы только на хосте среды (`docker/env/*.env`).

## CI/CD (ADR-0009)

- CI — GitHub Actions (`ubuntu-latest`). Гейты PR: **checks** (`nx affected` lint/fsd/typecheck/test с
  порогами покрытия/build), **api-e2e** (Node 22 и 24, PostgreSQL + Redis через `docker compose`),
  **web-e2e** (Playwright + axe). Nightly: `npm audit`, Trivy, Dependabot. Actions — только по SHA,
  `permissions: contents: read`, секретов в CI нет, Nx Cloud не подключается.
- Пока workflow-файлы не созданы — перед каждым PR вручную `npm run check`.
- Деплой (CD) — отдельным ADR; до него — ручная выкладка образов на VPS (ADR-0020, `docs/guides/deploy-vps.md`).

## Security constraints

- No secrets in code, committed config, or docs. No real client data anywhere, including fixtures.
- Follow the mandatory project rules (section «Правила», п. 3; ADR-0011): no self-made crypto,
  no client data to external LLMs/SaaS, no external SaaS DBs for tenant data, closed list of integrations.
- Пароли — только хеши; PIN ≥ 4 цифр; HTTPS на всех соединениях; таймаут сессии кассира —
  настройка на уровне сети тенанта.
- JWT — только носитель идентификаторов (`jti`, `sub`, `tid`, `aud`): права и ПДн в токен не кладутся, без
  записи сессии на сервере токен недействителен. `AUTH_TEST_COOKIES=true` (cookie `sid` без `Secure`, для
  e2e) допустим только при `APP_ENV=test`.

## AI usage rules (vibe-coding)

- Never paste secrets or real client data into prompts, code, or fixtures; use synthetic data.
- Dependencies only from the public npm registry / official Docker images; check licenses before adding.
- AI-generated code is merged ONLY after human review.
