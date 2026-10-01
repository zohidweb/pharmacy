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
| Кэш / сессии | Redis | ADR-0001 |
| API-стиль | REST | ADR-0001 |
| Аутентификация | Самописная: логин+пароль, PIN терминала; scrypt из `node:crypto`, cookie-сессии (Redis; офлайн — PostgreSQL) | ADR-0001, ADR-0008 |
| Авторизация | RBAC: динамические роли тенанта, каталог прав `модуль:действие` (`libs/shared/domain`), одна роль + охват точек, запрет эскалации, проверка только на сервере | ADR-0018 |
| Архитектура фронтенда | Feature-Sliced Design в `apps/web` и `apps/admin` («pages first», Steiger) | ADR-0017 |
| Фронтенд-библиотеки | TanStack Query, Zustand, React Hook Form + zod, use-intl, idb, uuid; свои: API-клиент, Service Worker, сканер | ADR-0015 |
| UI и стили (web, admin, libs/ui) | Tailwind CSS v4 поверх токенов `--ph-*`; собственный кит `libs/ui` без UI-зависимостей | ADR-0007 |
| Доступ к данным / миграции | Kysely + `pg` (CamelCasePlugin), SQL-миграции node-pg-migrate (только Up) | ADR-0006 |
| Контейнеризация | Docker (офлайн-дистрибутив, test/prod, локальная среда) | ADR-0005 |
| Организация кода | Nx-монорепо, единый репозиторий | ADR-0002, ADR-0010 |
| Runtime / тесты | Node.js 22 LTS (≥ 22.20) или 24 LTS (`.nvmrc` — 24, Docker — 24), npm, Jest; e2e фронтенда — Playwright | ADR-0008, ADR-0009 |
| CI | GitHub Actions | ADR-0009 |

**Ещё не решено — ADR в статусе `proposed`, до `accepted` не использовать:**
ADR-0012 reverse proxy и статика (отложен до выбора хостинга).

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
│   ├── api/          # NestJS: модульный монолит — src/app/{catalog, inventory, pos, purchasing,
│   │                 #   pricing, returns, billing, sync, fiscal, export-1c, audit}
│   ├── api-e2e/      # e2e-тесты API (Jest)
│   ├── web/          # Next.js: клиентский продукт (касса, склад, кабинет владельца)
│   │                 #   app/ — маршруты (реэкспорты), pages/ — пустая; src/{app,pages,widgets,features,entities,shared} — FSD (ADR-0017)
│   └── admin/        # Next.js: админка оператора платформы — та же структура FSD
│                     # web-e2e / admin-e2e — после ADR-0009
├── libs/
│   ├── shared/dto/     # @pharmacy/shared-dto — DTO и контракты REST API (единственный источник типов API)
│   ├── shared/domain/  # @pharmacy/shared-domain — Tenant, Store, Batch, Receipt, StockMovement…
│   ├── shared/util/    # @pharmacy/shared-util — деньги (integer дирамы), даты, i18n RU/TJ
│   └── ui/             # @pharmacy/ui — общий UI-кит web и admin (сенсорные экраны от 10″)
├── docker/           # compose.yml + образы postgres/, redis/ (ADR-0005); apps/api/Dockerfile
├── docs/architecture/, templates/   # архитектура, ADR; шаблоны ai-project-start
└── nx.json / package.json / tsconfig.base.json / eslint.config.mjs
```

Границы модулей (`@nx/enforce-module-boundaries`, теги в `package.json` → `nx.tags`):
- apps (`type:app`) не импортируют друг друга — только libs;
- `type:domain` не зависит ни от чего прикладного; `scope:api` не импортирует `type:ui`;
- модули api общаются через публичные интерфейсы (`exports`) модулей, не через чужие внутренности.

## Build / test / lint

```
npm ci                               # установка строго по lock-файлу
npx nx run-many -t build test lint fsd   # всё (= npm run check)
npx nx affected -t build test lint fsd   # только затронутое изменением
npx nx fsd web / admin               # Steiger — слои FSD (ADR-0017)
npx nx serve api                     # http://localhost:3000/api/v1/health
npx nx dev web                       # http://localhost:4200 (/api/* проксируется на :3000, только dev)
npx nx dev admin                     # http://localhost:4300
npx nx e2e api-e2e                   # e2e API (поднимает api сам)
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
- Аудит и журнал ПКУ — append-only (без UPDATE/DELETE на уровне БД).
- Миграции БД — версионированные (инструмент — ADR-0006); никакого schema-sync в проде.
- NestJS: один модуль = один домен; DTO с class-validator в libs/shared/dto; без бизнес-логики
  в контроллерах.
- Next.js: `output: 'export'` — без SSR/ISR, Server Actions, Route Handlers и middleware; данные
  только через apps/api; касса офлайн-устойчива — буфер перебоев связи как очередь операций в
  браузере с идемпотентной досылкой.
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

| Среда | Env-файл (не в git) | Compose-проект | API | PostgreSQL / Redis наружу |
|---|---|---|---|---|
| dev | `.env` ← `.env.example` | `pharmacy-dev` | `127.0.0.1:3000` | `5432` / `6379` на localhost |
| test | `docker/env/test.env` | `pharmacy-test` | `127.0.0.1:3100` | PostgreSQL `127.0.0.1:5433`, Redis — нет |
| prod | `docker/env/prod.env` | `pharmacy-prod` | `127.0.0.1:3200` | нет (только сеть compose, C4) |

```
npm run stack -- <dev|test|prod> <init|build|up|down|ps|logs> [service…] [--skip-checks]
npm run stack -- test init     # env-файл из примера со случайными паролями (один раз)
npm run test-env:build         # lint + test + static web/admin + образы с тегом <git sha>
npm run test-env:up            # запуск и ожидание healthy;  test-env:down — остановка
npm run prod:build / prod:up / prod:down
```

- Скрипт: `tools/scripts/stack.mjs`; compose: `docker/compose.yml` + `docker/compose.<env>.yml`.
- `build` — ручной quality gate, пока CI не выбран через ADR: lint + test всех
  проектов, затем сборка. Для prod `--skip-checks` запрещён, а сборка — только из чистого дерева
  git (тег образа = короткий sha; у test с незакоммиченными изменениями — `<sha>-dirty`).
- `up` для test/prod запускает ровно те образы, что собрал `build` (`--no-build`).
- Env-файлы сред лежат в `docker/env/`, а не `.env.test`: Nx автоматически грузит `.env.<имя>`
  в задачи (`.env.test` попал бы в `nx test`). В корневом `.env` не задавать `NODE_ENV`.
- `APP_ENV` (dev|test|prod) — среда развёртывания; `NODE_ENV` в test/prod всегда `production`.
- В env-файлах сред обязательны `PHARMACY_OWNER_PASSWORD`, `PHARMACY_APP_PASSWORD` и `PHARMACY_PLATFORM_PASSWORD`.
  Роли создаёт initdb только на пустом томе: существующие тома (`pharmacy-<env>_pg-data`) после появления
  новых ролей нужно пересоздать (`docker volume rm`, данные теряются — только для test/dev).
- web/admin в test/prod пока только собираются в `apps/*/out`; раздача — с reverse proxy (ADR-0012, proposed).
- Сейчас обе среды запускаются локально; хостинг — открытый вопрос № 1 stack.md.

## Containers (ADR-0005)

- Образы: `apps/api/Dockerfile` (multi-stage, `nx run api:prune`, non-root), `docker/postgres`
  (роли `pharmacy_owner` / `pharmacy_app` / `pharmacy_platform` / `pharmacy_resolver`, схема
  `pharmacy`, `pg_trgm`), `docker/redis` (без персистентности). Контекст сборки — корень репозитория
  (`.dockerignore`).
- Роли БД (ADR-0006, ADR-0013): база принадлежит `pharmacy_owner`. API в рантайме подключается ролями
  `pharmacy_app` (tenant-путь, `DATABASE_URL`) и `pharmacy_platform` (только `app/platform/**` и
  `app/sync/**`, `PLATFORM_DATABASE_URL`); `pharmacy_resolver` — NOLOGIN (владелец функций SECURITY DEFINER).
  `pharmacy_owner` используется только сервисом `migrate`; `PHARMACY_OWNER_PASSWORD` не передаётся в `api`.
- Миграции: одноразовый сервис `migrate` (тот же образ `pharmacy/api`, `node scripts/migrate.mjs`) применяет
  SQL-миграции ролью `pharmacy_owner` до старта API (`api` ждёт `service_completed_successfully`). Скрипт и
  `migrations/` попадают в образ через assets webpack.
- web/admin контейнеризуются вместе с reverse proxy после принятия ADR-0012 (proposed); до этого — `npx nx dev`.
- Порты в compose публикуются только на `127.0.0.1`.

## Local development secrets

- Never commit secrets (passwords, keys, connection strings, tokens) to git, in any form.
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
- Деплой (CD) — после выбора хостинга, отдельным ADR.

## Security constraints

- No secrets in code, committed config, or docs. No real client data anywhere, including fixtures.
- Follow the mandatory project rules (section «Правила», п. 3; ADR-0011): no self-made crypto,
  no client data to external LLMs/SaaS, no external SaaS DBs for tenant data, closed list of integrations.
- Пароли — только хеши; PIN ≥ 4 цифр; HTTPS на всех соединениях; таймаут сессии кассира —
  настройка на уровне сети тенанта.

## AI usage rules (vibe-coding)

- Never paste secrets or real client data into prompts, code, or fixtures; use synthetic data.
- Dependencies only from the public npm registry / official Docker images; check licenses before adding.
- AI-generated code is merged ONLY after human review.
