<!-- based on /04 output (docs/architecture/generated/CLAUDE.pharmacy-app.md), merged per ADR-0010 -->
<!-- ai-project-start version: 0.2.2 | tech radar version: 1.3 -->

# CLAUDE.md — Pharmacy (SaaS-платформа автоматизации сети аптек)

Единый репозиторий (ADR-0010): архитектурные артефакты (`docs/architecture/`, `tech-radar/`) и
Nx-монорепо кода (`apps/`, `libs/`) в корне. Общение с пользователем и командой — на русском;
идентификаторы и комментарии в коде — на английском.

Project class: Full

## Правила

1. **Новое архитектурное решение → сначала ADR** (`/03-adr`, `docs/architecture/adr/`), потом код:
   смена/добавление технологии или библиотеки уровня фреймворка, новая интеграция, новый
   компонент, изменение границ модулей. ADR может идти в том же MR, но принимается до слияния кода.
   ADR в статусе `proposed` — ещё не решение: реализовывать нельзя.
2. **Техрадар — закон.** Канонический источник:
   https://gitlab.eskhata.com/zsaidov/ai-project-start.git; локальная копия
   tech-radar/RADAR.md (v1.3) обновляется только через /update-radar — ручные правки копии
   недействительны. Технология вне радара → tech-radar/EXCEPTIONS.md, никогда молча.
   Категории «На утверждении» (брокеры, секреты, криптобиблиотеки, логирование и аудит,
   мониторинг, CI/CD, API gateway…) — использовать нельзя. tech-radar/** и templates/** — read-only.
3. Утверждённые исключения этого проекта (одноразовые, апрув 2026-09-29, APPROVAL.md):
   ADR-0003 NestJS, ADR-0004 Next.js, ADR-0005 Docker. На другие проекты не распространяются.
4. Изменения stack.md / C4, меняющие утверждённую архитектуру, требуют повторного вынесения
   на Архитектурный комитет (обновление APPROVAL.md).

## Fixed technology stack (do not deviate)

| Слой | Технология | Статус |
|---|---|---|
| Backend | NestJS (Express adapter), TypeScript strict | Исключение ADR-0003 |
| Frontend (web, admin) | Next.js (React, TypeScript), **static export (SPA)** | Исключение ADR-0004 |
| БД | PostgreSQL | Приоритет |
| Кэш / сессии | Redis | Утверждено |
| API-стиль | REST | Утверждено |
| Аутентификация | Самописная (логин+пароль, PIN терминала) | Утверждено; согласовано с ИБ (APPROVAL.md) |
| Контейнеризация | Docker (офлайн-дистрибутив, локальная среда) | Исключение ADR-0005 |
| Организация кода | Nx-монорепо, единый репозиторий | ADR-0002, ADR-0010 |
| Runtime / тесты | Node.js 24 (`.nvmrc`), npm, Jest | — |

**Ещё не решено — ADR в статусе `proposed`, до `accepted` не использовать:**
ADR-0006 слой доступа к данным и миграции · ADR-0007 CSS-подход и UI-кит (Tailwind, Base UI) ·
ADR-0008 реализация аутентификации (хеширование, сессии; нужен апрув ИБ) ·
ADR-0009 инструменты тестирования и пороги качества (в т.ч. Playwright для web/admin e2e).

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
├── docker/           # compose.dev.yml — локальные PostgreSQL + Redis; офлайн-дистрибутив (ADR-0005)
├── docs/architecture/, tech-radar/, templates/   # архитектура (read-only: tech-radar, templates)
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
npx nx dev web / npx nx dev admin    # фронтенды
npx nx e2e api-e2e                   # e2e API (поднимает api сам)
docker compose -f docker/compose.dev.yml --env-file .env up -d   # PostgreSQL + Redis локально
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

## Git / merge requests

- Branch naming: `feature/<task-id>-<slug>` or `fix/<task-id>-<slug>`, from an up-to-date `main`.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Direct pushes to `main` are forbidden — every change goes through a merge request.
- A merge request requires at least one approve from a human developer of the team; an AI is
  never the reviewer of record.
- The MR description states what was done, links the ADR when an architectural decision is
  involved, and how it was verified (tests run, manual checks). AI-assisted MRs are labeled `ai-assisted`.

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

Only these. No direct ABS database access. Financial operations require idempotency and a correlation ID.

| Система | Протокол | Формат |
|---|---|---|
| 1С:Бухгалтерия 8 (Таджикистан) | Файловый обмен, выгрузка вручную за период | CommerceML/XML |
| Фискализация (онлайн-ККМ) | Адаптер отправки чека; в MVP — заглушка | По требованиям вендора (не выбран, вопрос № 9 stack.md) |
| Курсы валют НБТ | Исходящий HTTPS-запрос курса на дату операции | JSON/HTML |
| Синхронизация офлайн-точек | HTTPS + лицензионный ключ точки, идемпотентная очередь | JSON |

Банковский эквайринг — БЕЗ интеграции. Новая интеграция = сначала новый ADR.

## Local development secrets

- Never commit secrets (passwords, keys, connection strings, tokens) to git, in any form.
- `.env` (API, docker compose) и `.env.local` (frontend) — в `.gitignore`; в git только `.env.example`
  без реальных значений.
- Production secrets live in the platform's secret store (category pending in the tech radar;
  вопрос № 8 в stack.md).

## CI/CD (interim rule)

Категория CI/CD радара — «На утверждении». До утверждения:
- run build, test, and lint manually before every MR;
- do not set up pipelines (GitHub Actions, GitLab CI и т.п.) outside the radar process.

## Security constraints

- No secrets in code, committed config, or docs. No real client data anywhere, including fixtures.
- Follow the "Запрещено" section of tech-radar/RADAR.md (no self-made crypto, no client data to
  external LLMs/SaaS, no external SaaS DBs for sensitive data).
- Пароли — только хеши; PIN ≥ 4 цифр; HTTPS на всех соединениях; таймаут сессии кассира —
  настройка на уровне сети тенанта.

## AI usage rules (vibe-coding)

- Never paste secrets or real client data into prompts, code, or fixtures; use synthetic data.
- Dependencies only from approved registries; check licenses before adding.
- AI-generated code is merged ONLY after human review.
