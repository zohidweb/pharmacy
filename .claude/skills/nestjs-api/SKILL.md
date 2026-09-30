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
last-reviewed: "2026-09-29"
---

## Pharmacy: контекст и ограничения

Скил адаптирован под Pharmacy — мультитенантную SaaS-платформу автоматизации сети аптек
(3 тенанта, ~30 точек, до 50 одновременных кассиров, рост ×5, операция кассы ≤ 1 сек;
офлайн-точка — та же система в Docker на ПК аптеки с локальной PostgreSQL).
Источник истины: `CLAUDE.md` репозитория `pharmacy` (ADR-0010)
`docs/architecture/stack.md`, `docs/architecture/adr/0002-stil-arhitektury.md`,
`docs/architecture/glossary.md`. При расхождении с этим скилом прав CLAUDE.md/ADR.

**Что адаптировано относительно оригинала (NestJS + Fastify + Prisma 7 + Vitest):**
- HTTP-адаптер — стандартный Express; структура — Nx (`apps/api`, `libs/shared/*`), генераторы `@nx/nest`, тесты — Jest;
- слой данных ORM-независимый: tenant-транзакции, RLS, атомарность «чек + движения + аудит»;
- аутентификация — самописная (логин+пароль, PIN терминала, сессии в Redis), не JWT;
- брокеры (BullMQ/RabbitMQ/Kafka) заменены очередями-таблицами PostgreSQL; OpenTelemetry/облачное логирование — встроенным `Logger`;
- удалено нерелевантное: GDPR, транзакционный email, feature flags, Stripe/webhooks, CI-пайплайны, GCP/Kubernetes.

**Требует ADR через `/03-adr` до использования** (примеры в reference помечены):
ORM/слой доступа к данным и инструмент миграций · Fastify-адаптер · библиотека хеширования
паролей/PIN (ADR-0008, proposed — решает архитектор проекта) ·
транспорт идентификатора сессии и защита от CSRF · протокол привязки терминала · вход
оператора «от имени» · раздача статики web на офлайн-точке · любая новая интеграция,
модуль или технология.

**Пока не выбрано — вводится только через ADR; до ADR действует текущее решение:**
брокеры сообщений → очереди-таблицы PostgreSQL (ADR-0002); хранилище секретов (Vault и т.п.) →
env-файлы; библиотека логирования (pino/winston/ELK) → встроенный Nest `Logger`;
мониторинг (OpenTelemetry, Prometheus, Sentry…) → не выбран; CI/CD → ручной прогон
`npm run check`; API gateway / ESB, push → не используются.

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
3. **Схема** — версионированная миграция: `tenant_id NOT NULL`, RLS, индексы `(tenant_id, …)`,
   append-only для журналов (`reference/nestjs-config-data-access.md`).
4. **Генерация** — генераторы Nx (в Nx ≥ 20 принимают путь; сверяйтесь с `--help`):
   ```bash
   npx nx g @nx/nest:module     apps/api/src/modules/<module>/<module>
   npx nx g @nx/nest:controller apps/api/src/modules/<module>/<resource>
   npx nx g @nx/nest:service    apps/api/src/modules/<module>/<resource>
   npx nx g @nx/nest:<generator> --help   # guard, interceptor, filter, pipe, resource…
   ```
5. **Код** — репозиторий (SQL с `tenant_id`, принимает `Tx`) → сервис (правила, одна
   транзакция с движениями и аудитом) → контроллер (`@RequirePermission`, DTO) —
   `reference/nestjs-templates-features.md`.
6. **Тесты (Jest)** — unit для правил; интеграционные с реальной PostgreSQL для изоляции
   тенантов и идемпотентности (`reference/nestjs-testing-*.md`).
7. **Проверка** — `npx nx affected -t build test lint`, `npx nx e2e api-e2e` (вручную или `npm run check`: CI пока не выбран — до ADR о CI).
8. **Ревью** — агенты из «Post-Code Review», затем обязательное ревью человеком.

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| **Modules** | 11 доменных модулей в `apps/api/src/modules/*`; взаимодействие только через экспортированные сервисы |
| **Controllers** | `@Controller({ path: '<plural-kebab>', version: '1' })` → `/api/v1/...`; без бизнес-логики |
| **DTOs** | `libs/shared/dto`, `class-validator`/`class-transformer`; деньги `*Dirams` с `@IsInt()`; нет `tenantId` |
| **Data access** | `DatabaseService.tenantTransaction(tx => …)`: `set_config('app.tenant_id', …, true)` + `WHERE tenant_id = $1`; RLS — второй рубеж |
| **Transactions** | Документ/чек + `stock_movements` + `audit_log` атомарно; `FOR UPDATE` на партиях; остаток = сумма движений |
| **Idempotency** | Заголовок `Idempotency-Key`, `UNIQUE (tenant_id, key)`, повтор возвращает исходный результат |
| **Errors** | Доменные исключения → `ProblemDetailsFilter` → `application/problem+json` (RFC 7807) с `code`, `correlationId` |
| **Auth** | Сессии в Redis (логин+пароль, PIN терминала); глобальные `SessionAuthGuard` + `PermissionsGuard` «модуль × действие × охват точек» |
| **Pagination** | `limit`/`offset` → `{ items, total, limit, offset }`, сортировка по whitelist |
| **Background work** | Очереди-таблицы PostgreSQL (`FOR UPDATE SKIP LOCKED`), outbox в транзакции операции |
| **Integrations** | Только закрытый список: фискализация (порт + заглушка MVP; HTTP-клиент вендора ККМ — `fetch` с таймаутом), 1С (файлы XML), синхронизация точек (лицензионный ключ) |
| **Config** | `@nestjs/config` + `registerAs()`, fail-fast; секреты — env; в git только `.env.example` |
| **Logging** | Встроенный `Logger`, correlation ID, маскирование ПДн/секретов |
| **Migrations** | Версионированные, инструмент по ADR; никакого schema-sync в проде |

## Reference Files

| File | Content | Load When |
|------|---------|-----------|
| `reference/nestjs-conventions.md` | Стек, раскладка, модули, инварианты, REST, именование | **Всегда первым** |
| `reference/nestjs-config-basics.md` | Fail-fast env reader, `registerAs()`, `.env.example` | Конфигурация |
| `reference/nestjs-config-npm-ts.md` | Зависимости (разрешённые/запрещённые), tsconfig, Nx targets | Зависимости, сборка |
| `reference/nestjs-config-data-access.md` | Tenant-транзакции, RLS, чек + движения, 23505 → 409, append-only, миграции; Prisma — вариант А | Любой доступ к БД |
| `reference/nestjs-templates-core.md` | `main.ts`, `AppModule`, `CoreModule`, correlation ID | Bootstrap |
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
npm run check                            # lint + test + build of all projects (manual, until an ADR on CI)
npm audit --omit=dev --audit-level=high  # dependency check (locally, no CI)
docker compose -f docker/compose.dev.yml up -d   # local PostgreSQL + Redis (ADR-0005)
```

Команды миграций появятся после ADR об инструменте миграций.

## Documentation Sources

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| NestJS | `https://docs.nestjs.com` | Декораторы, модули, guards, pipes, filters, Terminus, throttler |
| NestJS / Nx / TypeScript | `Context7` MCP | Актуальный синтаксис API и генераторов `@nx/nest` |
| PostgreSQL | скил `postgres-best-practices` | RLS, индексы, блокировки, очереди-таблицы |
| Prisma (только при ADR, выбравшем Prisma) | `https://www.prisma.io/docs/llms.txt` | Схема, миграции, клиент |

## Error Handling

- **Валидация** — `class-validator` в DTO; глобальный `ValidationPipe` → 400 problem+json с `errors[]`.
- **Не найдено** (в т.ч. ресурс другого тенанта/точки) — `ResourceNotFoundException` → 404.
- **Бизнес-правило** (нет остатка, смена закрыта, ПКУ без рецепта) — `BusinessRuleException` → 422 с `code`.
- **Дубликат** — unique violation PostgreSQL `23505` (у ORM — его обёртка) → 409; повтор
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
  Fastify, an ORM/migration tool without ADR, pino/winston/OpenTelemetry/Sentry, Vault,
  JWT/OAuth/Passport as the auth standard, Vitest — each only via an accepted ADR.
- No external SaaS databases for tenant data; no PII or client data sent to external LLMs/SaaS;
  no integrations outside the closed list (1С, fiscalization, offline-store sync); TJS is the only currency (ADR-0016).
- No self-made cryptography; password/PIN hashing only via the library chosen by an accepted ADR (ADR-0008).
- No route without `@RequirePermission(...)` or an explicit `@Public()`.
- No schema auto-sync (`synchronize: true`, `prisma db push`) outside a throwaway local DB.
- No PII, passwords, PINs, session tokens or license keys in logs or error bodies; no `console.*`.
- No secrets or real client data in code, fixtures or `.env.example`.
- No SQL built from input by string interpolation — raw SQL or ORM raw queries only with parameters
  (`$n` / tagged templates); dynamic identifiers (sort columns) only from a fixed whitelist.

## Post-Code Review

After writing TypeScript code in apps/api, dispatch:
- `nestjs-reviewer` — module correctness, tenant isolation, invariants, security, tests
  (checklist: `reference/nestjs-review-checklist.md`);
- `postgresql-database-reviewer` — only when the change touches SQL, schema or migrations.

AI review never replaces the mandatory human review of the merge request.
