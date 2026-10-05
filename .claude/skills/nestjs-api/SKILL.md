---
name: nestjs-api
description: NestJS backend patterns for the Pharmacy multi-tenant SaaS (pharmacy chains, Tajikistan) — apps/api in the Nx monorepo pharmacy, a modular monolith (catalog, inventory, pos, purchasing, pricing, returns, billing, sync, fiscal, export-1c, audit) on NestJS + Express, TypeScript strict, PostgreSQL, Redis, REST /api/v1, Jest. Covers modules, controllers, services, tenant-scoped repositories and transactions (tenant_id + set_config app.tenant_id for RLS), DTOs in libs/shared/dto with class-validator, RFC 7807 problem+json errors, limit/offset pagination, custom login+password and terminal PIN auth with Redis server sessions, permission guards «модуль × действие × охват точек», idempotency keys and correlation IDs, money as integer dirams, stock derived from batch movements, append-only audit, fiscal adapter (port + MVP stub, vendor HTTP client with timeout/retry/circuit breaker), TJS-only money (ADR-0016), 1C CommerceML export, Docker for the offline store. Use when creating or reviewing NestJS modules, controllers, services, DTOs, guards, interceptors, filters or Jest tests in apps/api — касса, чек, склад, партии, остатки, мультитенантность, сессии, права.
allowed-tools: Bash, Read, Write, Edit
source: "adapted from kumaran-is/claude-code-onboarding (MIT), develop@a7f2fc5"
metadata:
  triggers: NestJS, Nest, apps/api, Nx nest generator, NestJS module, NestJS controller, NestJS service, NestJS guard, DTO class-validator, libs/shared/dto, tenant_id, мультитенантность, tenantTransaction, RLS, idempotency key, идемпотентность, correlation ID, problem+json, RFC 7807, limit offset, Redis session, PIN терминала, права модуль действие охват, чек, receipt, stock movements, остатки, партии, дирамы, аудит, фискализация, ККМ, выгрузка 1С, Jest
  related-skills: postgres-best-practices, react-dev
  domain: backend
  role: specialist
  scope: implementation
  output-format: code
last-reviewed: "2026-10-02"
---

## Pharmacy: контекст и ограничения

Скил адаптирован под Pharmacy — мультитенантную SaaS-платформу автоматизации сети аптек
(3 тенанта, ~30 точек, до 50 одновременных кассиров, рост ×5, операция кассы ≤ 1 сек;
офлайн-точка — та же система в Docker на ПК аптеки с локальной PostgreSQL).
Источник истины: `CLAUDE.md` репозитория `pharmacy` (ADR-0010)
`docs/architecture/stack.md`, `docs/architecture/adr/0002-stil-arhitektury.md`,
`docs/architecture/glossary.md`. При расхождении с этим скилом прав CLAUDE.md/ADR.

**Что адаптировано относительно оригинала (NestJS + Fastify + Prisma 7 + Vitest):** <!-- docs-check: ok -->

- HTTP-адаптер — стандартный Express; структура — Nx (`apps/api`, `libs/shared/*`), генераторы `@nx/nest`, тесты — Jest;
- слой данных — Kysely поверх `pg`, миграции node-pg-migrate (ADR-0006): tenant-транзакции, RLS, атомарность «чек + движения + аудит»; кросс-тенантный путь — `PlatformDatabase` без `BYPASSRLS` (ADR-0013);
- аутентификация — самописная (логин+пароль, PIN терминала, scrypt из `node:crypto`, ADR-0008): токен — JWT через `@nestjs/jwt` в HttpOnly-cookie, но источник истины — серверная сессия (Redis), stateless-JWT не используется; авторизация — RBAC с каталогом прав `модуль:действие` (ADR-0018);
- брокеры (BullMQ/RabbitMQ/Kafka) заменены очередями-таблицами PostgreSQL; OpenTelemetry/облачное логирование — встроенным `Logger`;
- удалено нерелевантное: GDPR, транзакционный email, feature flags, Stripe/webhooks, CI-пайплайны, GCP/Kubernetes.

**Решено принятыми ADR** (используем как есть): Kysely + `pg`, node-pg-migrate (ADR-0006) ·
scrypt из `node:crypto`, JWT (`@nestjs/jwt`) в cookie `__Host-sid` с проверкой серверной сессии, CSRF через
Fetch Metadata / `Origin`, device-cookie терминала, node-redis (ADR-0008; вход «от имени» не реализуется —
решение пересматривается) ·
роли БД и `PlatformDatabase` (ADR-0013) · протокол синхронизации офлайн-точек (ADR-0014) ·
RBAC и каталог прав (ADR-0018) · тесты и CI на GitHub Actions (ADR-0009).

**Требует ADR через `/03-adr` до использования:** Fastify-адаптер · раздача статики web
(ADR-0012, proposed) · хранение файлов (фото рецептов ПКУ) · любая новая интеграция, модуль или
технология.

**Пока не выбрано — вводится только через ADR; до ADR действует текущее решение:**
брокеры сообщений → очереди-таблицы PostgreSQL (ADR-0002); хранилище секретов (Vault и т.п.) →
env-файлы; библиотека логирования (pino/winston/ELK) → встроенный Nest `Logger`;
мониторинг (OpenTelemetry, Prometheus, Sentry…) → не выбран; CD → после выбора хостинга;
API gateway / ESB, push → не используются.

**Правила проекта (без исключений):** никакой самописной криптографии — только проверенные
библиотеки и алгоритмы; персональные и клиентские данные не отправляются во внешние LLM и SaaS;
никаких внешних SaaS-БД для данных тенантов — только собственная PostgreSQL; закрытый список
интеграций (1С, фискализация, синхронизация офлайн-точек), новая — через ADR.
Единственная валюта — сомони (TJS, integer-дирамы), курсов и валютных полей нет (ADR-0016).

## Iron Law

**NO NESTJS MODULE WITHOUT READING `reference/nestjs-conventions.md` FIRST — tenant isolation (tenant_id in every data path), integer-diram money, stock derived from movements, append-only audit, idempotency + correlation ID, and the fixed stack are defined there**

# NestJS REST API — Pharmacy apps/api

## Conventions & Rules

> Раскладка apps/api, правила модулей, инварианты данных, REST, именование, конфиг и логи —
> `reference/nestjs-conventions.md`. Доступ к данным — `reference/nestjs-config-data-access.md`.

## Process

1. **Проверить, нужен ли ADR** — новая технология, интеграция, модуль или смена границ →
   сначала `/03-adr` в архитектурном репозитории (`reference/nestjs-rest-workflow.md`, шаг 0).
2. **Контракт** — DTO, query-DTO, коды ошибок в `libs/shared/dto` (без `@nestjs/*`);
   термины — из глоссария.
3. **Схема** — миграция node-pg-migrate (`apps/api/migrations/*.sql`, только Up) по модели
   данных `docs/architecture/data-model/`: ключ `(tenant_id, id)`, составные ссылки, RLS
   `TO pharmacy_app`, явные гранты, запись в `table-classes.ts`; затем `npx nx run api:migrate`
   и `npx nx run api:db-types` (`reference/nestjs-config-data-access.md`).
4. **Генерация** — генераторы Nx (в Nx ≥ 20 принимают путь; сверяйтесь с `--help`):
   ```bash
   npx nx g @nx/nest:module     apps/api/src/app/<module>/<module>
   npx nx g @nx/nest:controller apps/api/src/app/<module>/<resource>
   npx nx g @nx/nest:service    apps/api/src/app/<module>/<resource>
   npx nx g @nx/nest:<generator> --help   # guard, interceptor, filter, pipe, resource…
   ```
5. **Код** — репозиторий (Kysely-запросы с `tenant_id`, принимает `TenantTransaction`) →
   сервис (правила, одна `tenantTransaction` с движениями и аудитом) → контроллер
   (`@RequirePermission`, DTO) — `reference/nestjs-templates-features.md`.
6. **Тесты (Jest)** — unit для правил; интеграционные `*.int-spec.ts` на реальной PostgreSQL
   (`npx nx run api:integration`) для изоляции тенантов и идемпотентности
   (`reference/nestjs-testing-*.md`).
7. **Проверка** — `npx nx affected -t build test lint`, `npx nx run api:integration`,
   `npx nx run api:db-types-verify`, `npx nx e2e api-e2e`; перед PR — `npm run check` (CI — GitHub
   Actions по ADR-0009; пока workflow-файлов нет, прогон ручной).
8. **Ревью** — агенты из «Post-Code Review», затем обязательное ревью человеком.

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| **Modules** | 11 доменных модулей в `apps/api/src/app/*`; взаимодействие только через экспортированные сервисы; платформенный код — `app/platform/**` |
| **Controllers** | `@Controller({ path: '<plural-kebab>', version: '1' })` → `/api/v1/...`; без бизнес-логики |
| **DTOs** | `libs/shared/dto`, `class-validator`/`class-transformer`; деньги `*Dirams` с `@IsInt()`; нет `tenantId` |
| **Data access** | `TenantDatabase.tenantTransaction(trx => …)` (Kysely; `set_config('app.tenant_id', …, true)` первым оператором) + `.where('tenantId', '=', tenantId)`; RLS — второй рубеж; кросс-тенантное — `PlatformDatabase.platformTransaction(actor, …)` только в `app/platform/**` |
| **Transactions** | Документ/чек + `stock_movements` + `audit_log` атомарно; `FOR UPDATE` на партиях; остаток = сумма движений |
| **Idempotency** | Заголовок `Idempotency-Key`, `UNIQUE (tenant_id, key)`, повтор возвращает исходный результат |
| **Errors** | Доменные исключения → `ProblemDetailsFilter` → `application/problem+json` (RFC 7807) с `code`, `correlationId` |
| **Auth** | JWT в cookie + серверная сессия в Redis (логин+пароль, PIN терминала; scrypt, ADR-0008); контекст строит `SessionMiddleware`, глобальные guard'ы по порядку `AuthGuard` → `CsrfGuard` → `PrincipalThrottlerGuard` → `PermissionsGuard` → `FreshAuthGuard`: `@RequirePermission('inventory:post')` по каталогу прав ADR-0018, охват точек, запрет по умолчанию |
| **Pagination** | `limit`/`offset` → `{ items, total, limit, offset }`, сортировка по whitelist |
| **Background work** | Очереди-таблицы PostgreSQL (`FOR UPDATE SKIP LOCKED`), outbox в транзакции операции |
| **Integrations** | Только закрытый список: фискализация (порт + заглушка MVP; HTTP-клиент вендора ККМ — `fetch` с таймаутом), 1С (файлы XML), синхронизация точек (лицензионный ключ) |
| **Config** | `@nestjs/config` + `registerAs()`, fail-fast; секреты — env; в git только `.env.example` |
| **Logging** | Встроенный `Logger`, correlation ID, маскирование ПДн/секретов |
| **Migrations** | node-pg-migrate, `.sql` только Up, роль `pharmacy_owner`; `CONCURRENTLY` — `.mjs` + `pgm.noTransaction()`; schema-sync запрещён |
| **IDs** | `newId()` — UUIDv7 из приложения (`core/database/ids.ts`, импорт только через index `core/database`), у `id` нет `default` в БД |

## Reference Files

| File | Content | Load When |
|------|---------|-----------|
| `reference/nestjs-conventions.md` | Стек, раскладка, модули, инварианты, REST, именование | **Всегда первым** |
| `reference/nestjs-config-basics.md` | Fail-fast env reader, `registerAs()`, `.env.example` | Конфигурация |
| `reference/nestjs-config-npm-ts.md` | Зависимости (разрешённые/запрещённые), tsconfig, Nx targets | Зависимости, сборка |
| `reference/nestjs-config-data-access.md` | `TenantDatabase`/`PlatformDatabase` на Kysely, RLS, чек + движения, коды ошибок, `bigint`, kysely-codegen, node-pg-migrate, интеграционные тесты | Любой доступ к БД |
| `reference/nestjs-templates-core.md` | `main.ts`, `AppModule`, глобальные модули ядра, correlation ID | Bootstrap |
| `reference/nestjs-templates-features.md` | Модуль catalog: DTO, контроллер, сервис, аудит | Новый модуль/ресурс |
| `reference/nestjs-templates-infrastructure.md` | Dockerfile, compose dev/offline, Jest-конфиг Nx | Docker, тест-раннер |
| `reference/nestjs-enterprise-patterns.md` | Исключения, RFC 7807 фильтр, статусы, версионирование | Ошибки, валидация |
| `reference/nestjs-enterprise-infrastructure.md` | helmet, Swagger (опц.), health checks | Заголовки, документация, health |
| `reference/nestjs-rate-limiting.md` | Throttler, Redis-хранилище, лимиты логина/PIN/sync | Rate limiting |
| `reference/nestjs-rest-workflow.md` | Процесс эндпоинта: ADR → DTO → миграция → код → тесты | Новый эндпоинт |
| `reference/nestjs-rest-dto-pagination.md` | Маппинг, limit/offset, фильтры, вложенные DTO чека | DTO, списки |
| `reference/nestjs-rest-upload-errors.md` | Выгрузка 1С, загрузка CSV, RFC 7807 | Файлы, ошибки |
| `reference/nestjs-rest-services.md` | Порт фискализации + заглушка, HTTP-клиент вендора ККМ, массовые операции, кэш | Сервисы, интеграции |
| `reference/nestjs-security-auth.md` | Логин+пароль, PIN, сессии Redis, guards прав, лицензионный ключ | Аутентификация, права |
| `reference/nestjs-security-scanning.md` | `npm audit`, eslint security, grep-аудит, CORS | Аудит безопасности |
| `reference/nestjs-security-validation-logging.md` | Валидация DTO, маскирование ПДн, безопасный SQL, OWASP | Вход, логи |
| `reference/nestjs-decision-trees.md` | Деревья решений: ADR, размещение, модули, транзакции, auth, кэш, ошибки | Перед реализацией |
| `reference/nestjs-review-checklist.md` | Чек-лист ревью (агент `nestjs-reviewer`) | Ревью, pre-MR |
| `reference/nestjs-testing-unit-basics.md` | Jest unit-тесты сервисов | Unit-тесты |
| `reference/nestjs-testing-unit-controllers.md` | Тесты контроллеров, фабрики данных | Unit-тесты контроллеров |
| `reference/nestjs-testing-unit-mocks.md` | Моки слоя данных, Redis, HTTP, конфига | Моки |
| `reference/nestjs-testing-integration-setup.md` | Реальная PostgreSQL, apps/api-e2e, supertest | Интеграционные/e2e |
| `reference/nestjs-testing-integration-patterns.md` | Тесты auth, изоляции тенантов, пагинации | Интеграционные сценарии |
| `reference/nestjs-testing-patterns.md` | Тесты устойчивости и контекста | Circuit breaker, ALS |
| `reference/nestjs-testing-ci-troubleshooting.md` | Покрытие, проблемы тестов | Покрытие, флейки |
| `reference/nestjs-messaging-basics.md` | Очереди-таблицы PostgreSQL, outbox | Фоновые задачи, sync, фискализация |
| `reference/nestjs-observability.md` | Структурные логи `Logger` + correlation ID; OTel — после ADR | Логирование |
| `reference/nestjs-resilience-circuit-breaker.md` | Circuit breaker, retry, timeout | Внешние вызовы |
| `reference/nestjs-resilience-context.md` | AsyncLocalStorage, correlation ID, контекст тенанта | Контекст запроса |
| `reference/nestjs-debugging-logging.md` | Debug-логи, логирование SQL | Отладка запросов |
| `reference/nestjs-debugging-context-di.md` | DI, контекст, конфиг | Ошибки DI |
| `reference/nestjs-debugging-performance.md` | Память, профилирование | Медленно/утечки |
| `reference/nestjs-debugging-production.md` | Диагностика прода и офлайн-точек | Инциденты |
| `reference/nestjs-real-world-issues.md` | Типовые проблемы NestJS с решениями | DI, циклы, память |

Навигация — `reference/index.md`.

## Common Commands

```bash
npx nx serve api                         # local run (watch)
npx nx test api                          # unit tests (Jest); --coverage, --watch
npx nx e2e api-e2e                       # e2e API
npx nx lint api                          # ESLint (incl. module boundaries, security)
npx nx build api --configuration=production
npx nx affected -t build test lint       # only what the change touches — run before every MR
npm run check                            # lint + fsd + test + build of all projects (before every PR)
npm audit --omit=dev --audit-level=high  # dependency check
npm run dev:deps                         # local PostgreSQL + Redis in Docker (ADR-0005)
npx nx run api:migrate                   # apply migrations to the dev DB (role pharmacy_owner)
npx nx run api:integration               # integration tests on pharmacy_test (needs dev:deps)
npx nx run api:db-types                  # regenerate DB types from the migrated schema
npx nx run api:db-types-verify           # fail if types drifted from the schema
```

## Documentation Sources

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| NestJS | `https://docs.nestjs.com` | Декораторы, модули, guards, pipes, filters, Terminus, throttler |
| NestJS / Nx / TypeScript | `Context7` MCP | Актуальный синтаксис API и генераторов `@nx/nest` |
| PostgreSQL | скил `postgres-best-practices` | RLS, индексы, блокировки, очереди-таблицы |
| Kysely | `https://kysely.dev/docs` | Query builder, транзакции, `forUpdate`, `onConflict` |
| node-pg-migrate | `https://salsita.github.io/node-pg-migrate/` | Миграции, `noTransaction` |

## Error Handling

- **Валидация** — `class-validator` в DTO; глобальный `ValidationPipe` → 400 problem+json с `errors[]`.
- **Не найдено** (в т.ч. ресурс другого тенанта/точки) — `ResourceNotFoundException` → 404.
- **Бизнес-правило** (нет остатка, смена закрыта, ПКУ без рецепта) — `BusinessRuleException` → 422 с `code`.
- **Дубликат** — unique violation PostgreSQL `23505` → 409; повтор
  idempotency key с тем же телом — исходный результат, с другим — 409.
- **Интеграция недоступна** (фискализация, синхронизация) — 502/503; касса не блокируется.
- Везде `correlationId` в ответе; никаких стеков, SQL, значений полей и ПДн в `detail`.

## Hard Prohibitions

- No raw `any` request bodies — every endpoint uses DTOs from `libs/shared/dto` with `class-validator`.
- No data access without tenant scope: every query to an application table runs in
  `tenantTransaction()` and filters by `tenant_id`; `tenantId` never comes from the client.
- No `float`/`numeric`/`Decimal` money — integer dirams only; no `parseFloat`/`toFixed` in money code.
- No stored stock balances — stock is `SUM(stock_movements)`; an operation and its movements commit in one transaction.
- No UPDATE/DELETE of `audit_log`, the ПКУ journal or `stock_movements` — append-only, corrections are reversals.
- No financial operation or sync endpoint without an idempotency key and correlation ID.
- No message brokers (BullMQ, RabbitMQ, Kafka, NATS…) — PostgreSQL queue tables (ADR-0002) until an ADR revises it.
- No technology outside `stack.md` and accepted ADRs (technologies from proposed ADRs are not used either):
  Fastify, another ORM or migration tool (ADR-0006 chose Kysely + node-pg-migrate),
  pino/winston/OpenTelemetry/Sentry, Vault, OAuth/Passport or stateless JWT as the auth standard (session JWT is only a carrier of ids, ADR-0008), Vitest —
  each only via an accepted ADR.
- No direct `pg` pool or root `Kysely` outside `core/database/**`; no `PlatformDatabase` outside
  `app/platform/**` and `app/sync/**`; inside a transaction only `trx` is used (ADR-0006, ADR-0013).
- No external SaaS databases for tenant data; no PII or client data sent to external LLMs/SaaS;
  no integrations outside the closed list (1С, fiscalization, offline-store sync); TJS is the only currency (ADR-0016).
- No self-made cryptography; password/PIN hashing only with scrypt from `node:crypto` behind `PasswordHasher` (ADR-0008).
- No route without `@RequirePermission('<module>:<action>')` from the permission catalog (ADR-0018) or an explicit `@Public()`.
- No schema auto-sync and no Down migrations; schema changes only via node-pg-migrate files.
- No PII, passwords, PINs, session tokens or license keys in logs or error bodies; no `console.*`.
- No secrets or real client data in code, fixtures or `.env.example`.
- No SQL built from input by string interpolation — raw SQL only via the Kysely `sql` tag with
  parameters; `sql.raw`/`sql.lit` never with input; dynamic identifiers (sort columns) only from a fixed whitelist.

## Post-Code Review

After writing TypeScript code in apps/api, dispatch:
- `nestjs-reviewer` — module correctness, tenant isolation, invariants, security, tests
  (checklist: `reference/nestjs-review-checklist.md`);
- `postgresql-database-reviewer` — only when the change touches SQL, schema or migrations.

AI review never replaces the mandatory human review of the merge request.
