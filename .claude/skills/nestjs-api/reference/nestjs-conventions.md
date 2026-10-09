# NestJS Conventions — Pharmacy (apps/api)

Обязательно к прочтению перед созданием любого модуля (Iron Law из SKILL.md).
Источник истины — `CLAUDE.md` репозитория `pharmacy` (ADR-0010) и `docs/architecture/stack.md`.

## Стек (зафиксирован, другое — только через ADR `/03-adr`)

- NestJS, Node.js LTS, TypeScript `strict`. HTTP-адаптер — стандартный Express
  (`@nestjs/platform-express`). Fastify — только после ADR.
- PostgreSQL — единственная БД; Redis — сессии, PIN-сессии терминалов, кэш каталога/цен.
- REST (`/api/v1/…`), JSON camelCase, ошибки RFC 7807 (`application/problem+json`).
- Тесты — Jest (стандарт Nx). Vitest не используем.
- Монорепо Nx: `apps/api` — модульный монолит (ADR-0002).
- Доступ к данным — Kysely + `pg`, миграции — node-pg-migrate (ADR-0006); хеш паролей/PIN —
  scrypt из `node:crypto` (ADR-0008); Redis-клиент — node-redis (ADR-0008); авторизация — RBAC
  с каталогом прав (ADR-0018).
- **Не выбрано (требует ADR до использования):** Fastify, OpenTelemetry/pino/winston, брокеры
  сообщений, хранение файлов.

## Раскладка apps/api

```
apps/api/
├── migrations/              # node-pg-migrate: <timestamp>_<name>.sql (only Up), .mjs for noTransaction
├── scripts/migrate.mjs      # the migrator (dev: nx run api:migrate; docker: service `migrate`)
├── test/                    # integration stand (database-urls, global-setup, connections, seed), architecture scanner
└── src/
    ├── main.ts
    ├── app/
    │   ├── app.module.ts    # root module: Config → DatabaseModule → auth → domain modules
    │   ├── config/          # env validation (fail-fast), registerAs() configs
    │   ├── health/
    │   ├── catalog/  inventory/  pos/  purchasing/  pricing/  returns/
    │   ├── billing/  sync/  fiscal/  export-1c/  audit/
    │   │   └── <module>.module.ts, *.controller.ts, *.service.ts, *.repository.ts
    │   └── platform/        # operator path (/api/v1/operator/*), the only importer of PlatformDatabaseModule
    ├── common/              # context (AsyncLocalStorage), filters (ProblemDetails), exceptions,
    │                        #   interceptors, middleware (correlation ID), logging
    └── core/
        └── database/        # TenantDatabase, DatabaseModule, pool, ids (newId), table-classes,
                             #   db.generated.ts (kysely-codegen), platform/ (PlatformDatabase)
```

DTO и контракты REST — **только в `libs/shared/dto`** (единственный источник типов API для
api, web, admin). Доменные типы и каталог прав — `libs/shared/domain`, деньги/даты/i18n —
`libs/shared/util`. Импорт — по имени пакета: `@pharmacy/shared-dto`, `@pharmacy/shared-domain`,
`@pharmacy/shared-util`.

## Правила модулей

- Один модуль = один домен из списка выше. Новый домен/модуль = изменение границ → ADR.
- Модули общаются только через **экспортированные сервисы** (публичный интерфейс модуля).
  Чужие репозитории, таблицы и внутренние сервисы не импортируются.
  Образец — `ProductsReader` модуля `catalog` (`exports: [ProductsReader]`): методы принимают
  транзакцию вызывающего (`trx`, `tenantId`) и отдают узкий тип (`PricingProduct`), а `pricing`
  импортирует `CatalogModule` и читает товары только через него.
- Склад: остаток — сумма `stock_movements` партии, движения только добавляются (сторно — `reversal` с
  `reverses_movement_id`). Перед проверкой остатка партии блокируются `FOR UPDATE` одним оператором, подсчёт — следующим
  (`DocumentsRepository.lockBatches`, затем `foreignMovements` / `batchStock`). Документ и его движения — одна
  транзакция; шапка документа блокируется `FOR UPDATE` до проверки статуса (`DocumentPosting`).
- Поиск подстрокой (`LIKE`) — по выражению с индексом `pg_trgm` (`lower(name ->> 'ru')`), ввод
  пользователя экранируется (`%`, `_`, `\` — `escapeLike` в `catalog.repository.ts`).
- Контроллер — только HTTP: DTO на входе, вызов сервиса, DTO на выходе. Бизнес-логика — в сервисе.
- Constructor injection; `@Global()` — только для Config и Core.
- `libs/shared/dto` не импортирует `@nestjs/*` (библиотеку используют и фронтенды):
  только `class-validator` / `class-transformer` и типы.

## Правила данных (инварианты системы)

- **tenant_id** — в каждой прикладной таблице и каждом запросе. `tenantId` берётся из
  серверной сессии (контекст запроса), **никогда** из body/query/params. Доступ к данным —
  только через `TenantDatabase.tenantTransaction()` и tenant-scoped репозитории, принимающие
  `TenantTransaction` (см. `nestjs-config-data-access.md`); RLS в PostgreSQL — второй рубеж.
  Кросс-тенантное — только `PlatformDatabase` в `app/platform/**` (ADR-0013).
- **Идентификаторы** — `newId()` (UUIDv7, файл `core/database/ids.ts`; импорт — только из `core/database` (index): экспорт добавить вместе с первым использующим его сервисом, глубокий импорт запрещает ESLint); ключ тенантной таблицы —
  `(tenant_id, id)` (модель данных `docs/architecture/data-model/`).
- **Деньги** — integer в дирамах (minor units TJS). Никаких `float`, `toFixed`, `parseFloat`,
  `decimal.js` для сумм. Округление себестоимости штуки при делении упаковки — вверх
  (в пользу аптеки); утилита — в `libs/shared/util`.
- **Остатки не хранятся** — выводятся как сумма движений по партиям (`stock_movements`).
  Документ/чек и его движения пишутся в одной транзакции.
- **Аудит и журнал ПКУ** — append-only: без UPDATE/DELETE (права БД + триггер).
- **Финансовые операции и синхронизация** — idempotency key + correlation ID.
- Миграции — node-pg-migrate, `.sql` только Up, применяет роль `pharmacy_owner` (ADR-0006);
  schema-sync запрещён.

## REST

- Префикс `/api`, URI-версионирование `v1` → `/api/v1/products`.
- Ресурсы — во множественном числе, kebab-case: `/api/v1/stock-movements`, `/api/v1/receipts`.
- Пагинация `limit`/`offset`; ответ списка — `{ items, total, limit, offset }`.
- Ошибки — RFC 7807 через глобальный фильтр (`nestjs-enterprise-patterns.md`).

## Именование

- Идентификаторы и комментарии — английские; доменные термины — из
  `docs/architecture/glossary.md`: tenant, store, employee, role, product, batch, stock movement,
  document, receipt, shift, payment, discount rule, controlled substance, supplier, license key,
  sync queue, invoice, audit log. Не изобретать синонимы (`user` → `employee`, `order` → `receipt`).
- Файлы — kebab-case: `stock-movements.repository.ts`, `create-receipt.dto.ts`.

## Конфигурация и секреты

- `@nestjs/config` + `registerAs()`; обязательные переменные — fail-fast при старте
  (`nestjs-config-basics.md`).
- `.env` — только локально, в `.gitignore`; в git — `.env.example` без реальных значений.
- Секреты в проде — переменные окружения / env-файлы среды деплоя (хранилище секретов пока
  не выбрано — вводится через ADR; до ADR Vault и т.п. не использовать).

## Логи

- Только встроенный `Logger` из `@nestjs/common` (библиотека логирования пока не выбрана — pino/winston только через ADR).
- В каждой записи — correlation ID; ПДн (сотрудники, поставщики, поля рецептов ПКУ),
  пароли, PIN, токены сессий, лицензионные ключи — маскируются
  (`nestjs-security-validation-logging.md`).
