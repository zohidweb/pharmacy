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
| Аутентификация | Самописная (логин+пароль, PIN терминала) | ADR-0001; реализация — ADR-0008 (proposed) |
| Доступ к данным / миграции | Kysely + `pg` (CamelCasePlugin), SQL-миграции node-pg-migrate (только Up) | ADR-0006 |
| Контейнеризация | Docker (офлайн-дистрибутив, test/prod, локальная среда) | ADR-0005 |
| Организация кода | Nx-монорепо, единый репозиторий | ADR-0002, ADR-0010 |
| Runtime / тесты | Node.js 24 (`.nvmrc`), npm, Jest | — |

**Ещё не решено — ADR в статусе `proposed`, до `accepted` не использовать:**
ADR-0007 CSS-подход и UI-кит (Tailwind, Base UI) ·
ADR-0008 реализация аутентификации (хеширование, сессии) ·
ADR-0009 инструменты тестирования и пороги качества (в т.ч. Playwright для web/admin e2e) ·
ADR-0012 reverse proxy и статика · ADR-0013 кросс-тенантный доступ · ADR-0014 протокол
синхронизации офлайн-точек · ADR-0015 фронтенд-стек.

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
│   └── admin/        # Next.js: админка оператора платформы
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
npx nx run-many -t build test lint   # всё
npx nx affected -t build test lint   # только затронутое изменением
npx nx serve api                     # http://localhost:3000/api/v1/health
npx nx dev web                       # http://localhost:4200 (/api/* проксируется на :3000, только dev)
npx nx dev admin                     # http://localhost:4300
npx nx e2e api-e2e                   # e2e API (поднимает api сам)

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
- Деньги — integer в дирамах (minor units), никакого float; округление себестоимости штуки
  при делении упаковки — вверх, в пользу аптеки (правило ТЗ).
- Мультитенантность: tenant_id обязателен во всех прикладных таблицах и запросах; доступ к
  данным — только через слой, применяющий фильтр тенанта (ADR-0002).
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
| Tailwind (только после ADR-0007 accepted) | скил `tailwind-patterns` |
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
- No self-made cryptography; password hashing only with the approach approved in ADR-0008.
- Financial operations carry idempotency and a correlation ID.
- Error handling does not silently swallow failures.
- tenant_id filtering present in every data access path (multi-tenancy isolation).

## Integrations (closed list)

Only these. Financial operations require idempotency and a correlation ID.

| Система | Протокол | Формат |
|---|---|---|
| 1С:Бухгалтерия 8 (Таджикистан) | Файловый обмен, выгрузка вручную за период | CommerceML/XML |
| Фискализация (онлайн-ККМ) | Адаптер отправки чека; в MVP — заглушка | По требованиям вендора (не выбран, вопрос № 9 stack.md) |
| Курсы валют НБТ | Исходящий HTTPS-запрос курса на дату операции | JSON/HTML |
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
- web/admin в test/prod пока только собираются в `apps/*/out`; раздача — с reverse proxy (ADR-0012, proposed).
- Сейчас обе среды запускаются локально; хостинг — открытый вопрос № 1 stack.md.

## Containers (ADR-0005)

- Образы: `apps/api/Dockerfile` (multi-stage, `nx run api:prune`, non-root), `docker/postgres`
  (роли `pharmacy_owner` / `pharmacy_app`, схема `pharmacy`, `pg_trgm`), `docker/redis` (без
  персистентности). Контекст сборки — корень репозитория (`.dockerignore`).
- API в рантайме подключается ТОЛЬКО ролью `pharmacy_app`; `pharmacy_owner` — для миграций.
- web/admin контейнеризуются вместе с reverse proxy после принятия ADR-0012 (proposed); до этого — `npx nx dev`.
- Порты в compose публикуются только на `127.0.0.1`.

## Local development secrets

- Never commit secrets (passwords, keys, connection strings, tokens) to git, in any form.
- `.env` (API, docker compose) и `.env.local` (frontend) — в `.gitignore`; в git только `.env.example`
  без реальных значений.
- Production secrets: хранилище секретов пока не выбрано — через ADR (вопрос № 8 в stack.md);
  до этого — env-файлы только на хосте среды (`docker/env/*.env`).

## CI/CD (interim rule)

CI/CD пока не выбран — вводится через ADR (например, GitHub Actions). До этого ADR:
- run build, test, and lint manually before every PR (`npm run check`);
- do not add pipeline files (`.github/workflows` и т.п.) without an accepted ADR.

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
