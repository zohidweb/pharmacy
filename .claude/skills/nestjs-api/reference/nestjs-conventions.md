# NestJS Conventions — Pharmacy (apps/api)

Обязательно к прочтению перед созданием любого модуля (Iron Law из SKILL.md).
Источник истины — `CLAUDE.md` кодового монорепо `pharmacy-app`
(генерируется из `docs/architecture/generated/CLAUDE.pharmacy-app.md`) и `docs/architecture/stack.md`.

## Стек (зафиксирован, другое — только через ADR `/03-adr`)

- NestJS, Node.js LTS, TypeScript `strict`. HTTP-адаптер — стандартный Express
  (`@nestjs/platform-express`). Fastify — только после ADR.
- PostgreSQL — единственная БД; Redis — сессии, PIN-сессии терминалов, кэш каталога/цен.
- REST (`/api/v1/…`), JSON camelCase, ошибки RFC 7807 (`application/problem+json`).
- Тесты — Jest (стандарт Nx). Vitest не используем.
- Монорепо Nx: `apps/api` — модульный монолит (ADR-0002).
- **Не выбрано (требует ADR до использования):** ORM/слой доступа к данным, инструмент миграций,
  Fastify, библиотека хеширования паролей, OpenTelemetry/pino/winston, брокеры сообщений.

## Раскладка apps/api

```
apps/api/src/
├── main.ts
├── app/app.module.ts        # корневой модуль: Config → Core → Auth → доменные модули
├── config/                  # registerAs()-конфиги, fail-fast чтение env
├── common/                  # filters (ProblemDetails), exceptions, interceptors,
│                            #   middleware (correlation ID), context (AsyncLocalStorage), logging
├── core/                    # database (DatabaseService, tenant-транзакции), redis, health
├── auth/                    # сессии Redis, PIN терминала, guards «модуль × действие × охват точек»
└── modules/
    ├── catalog/  inventory/  pos/  purchasing/  pricing/  returns/
    └── billing/  sync/  fiscal/  export-1c/  audit/
        └── <module>.module.ts, *.controller.ts, *.service.ts, *.repository.ts
```

DTO и контракты REST — **только в `libs/shared/dto`** (единственный источник типов API для
api, web, admin). Доменные типы — `libs/shared/domain`, деньги/даты/i18n — `libs/shared/util`.
Алиасы импорта — как заданы в `tsconfig.base.json` (в примерах: `@pharmacy/shared/dto`).

## Правила модулей

- Один модуль = один домен из списка выше. Новый домен/модуль = изменение границ → ADR.
- Модули общаются только через **экспортированные сервисы** (публичный интерфейс модуля).
  Чужие репозитории, таблицы и внутренние сервисы не импортируются.
- Контроллер — только HTTP: DTO на входе, вызов сервиса, DTO на выходе. Бизнес-логика — в сервисе.
- Constructor injection; `@Global()` — только для Config и Core.
- `libs/shared/dto` не импортирует `@nestjs/*` (библиотеку используют и фронтенды):
  только `class-validator` / `class-transformer` и типы.

## Правила данных (инварианты системы)

- **tenant_id** — в каждой прикладной таблице и каждом запросе. `tenantId` берётся из
  серверной сессии (контекст запроса), **никогда** из body/query/params. Доступ к данным —
  только через `DatabaseService.tenantTransaction()` / tenant-scoped репозитории
  (см. `nestjs-config-data-access.md`); RLS в PostgreSQL — второй рубеж.
- **Деньги** — integer в дирамах (minor units TJS). Никаких `float`, `toFixed`, `parseFloat`,
  `decimal.js` для сумм. Округление себестоимости штуки при делении упаковки — вверх
  (в пользу аптеки); утилита — в `libs/shared/util`.
- **Остатки не хранятся** — выводятся как сумма движений по партиям (`stock_movements`).
  Документ/чек и его движения пишутся в одной транзакции.
- **Аудит и журнал ПКУ** — append-only: без UPDATE/DELETE (права БД + триггер).
- **Финансовые операции и синхронизация** — idempotency key + correlation ID.
- Миграции — версионированные (инструмент — первым ADR разработки); schema-sync в проде запрещён.

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
- Секреты в проде — переменные окружения среды деплоя (категория «Управление секретами» в
  радаре на утверждении; Vault и т.п. не использовать).

## Логи

- Только встроенный `Logger` из `@nestjs/common` (pino/winston — после решения радара).
- В каждой записи — correlation ID; ПДн (сотрудники, поставщики, поля рецептов ПКУ),
  пароли, PIN, токены сессий, лицензионные ключи — маскируются
  (`nestjs-security-validation-logging.md`).
