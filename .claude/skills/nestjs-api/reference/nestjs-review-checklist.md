# NestJS Code Review Checklist — Pharmacy apps/api

Используется агентом `nestjs-reviewer`. Изменения схемы БД/миграций дополнительно ревьюит
`postgresql-database-reviewer`. Итоговое решение о мерже — всегда за человеком-ревьюером
команды (AI не является reviewer of record).

## Severity

| Уровень | Критерий | Действие |
|---|---|---|
| **CRITICAL** (P0) | Утечка между тенантами, нарушение инварианта денег/остатков/аудита, дыра безопасности, технология вне stack.md / accepted ADR, секреты/реальные данные в diff | Блокирует мерж |
| **HIGH** (P1) | Нет идемпотентности финоперации, нет теста изоляции, проглоченные ошибки, внешний вызов в транзакции кассы, ПДн в логах | Блокирует мерж |
| **MEDIUM** (P2) | Дублирование, сложность, слабые тесты, отступление от конвенций REST/именования | Можно мержить с зафиксированным тикетом |
| **LOW** (P3) | Стиль, мелкие улучшения | Бэклог |

## 1. Инварианты Pharmacy (CRITICAL)

- [ ] **tenant_id в каждом пути доступа**: каждый запрос к прикладной таблице фильтрует по
      `tenant_id`; выполняется внутри `TenantDatabase.tenantTransaction()` (или `withTenant` —
      только guards и job runner); `tenantId` — из контекста сессии, не из body/query/params;
      ключи кэша Redis содержат `tenantId`.
- [ ] **Только `trx` внутри транзакции**: нет обращения к корневому `Kysely`/пулу при наличии
      `trx`; нет импорта `pg` и внутренних файлов `core/database/*` вне `core/database/**`;
      `PlatformDatabase` — только в `app/platform/**`, `app/sync/**` (ADR-0006, ADR-0013).
- [ ] **Raw SQL**: только тег `sql` с параметрами; `sql.raw`/`sql.lit` со входными данными —
      CRITICAL; тип `sql<T>` покрыт тестом.
- [ ] Новая таблица (по модели данных): ключ `(tenant_id, id)`, `id` без `default` (`newId()`),
      составные ссылки, RLS `ENABLE` + `FORCE`, политика `TO pharmacy_app` без `missing_ok`,
      явные гранты по классу, запись в `table-classes.ts`, регенерированный `db.generated.ts`.
- [ ] **Деньги — integer дирамы**: нет `float`/`numeric`-арифметики, `parseFloat`, `toFixed`,
      `Decimal`; в DTO `@IsInt()`; `int8` приходит как `bigint` (type parser пула) и
      преобразуется в DTO явно; округление себестоимости штуки — вверх.
- [ ] **Остатки из движений**: нет таблиц/колонок с хранимым остатком; остаток =
      `SUM(stock_movements.qty_delta_pieces)`; документ/чек и его движения — одна транзакция;
      партии блокируются `FOR UPDATE` **отдельным оператором до** подсчёта (ADR-0006 п. 2).
- [ ] **Append-only аудит, ПКУ, движения**: нет UPDATE/DELETE по `audit_log`,
      `controlled_sale_records` (кроме очистки данных рецепта по сроку), `stock_movements`,
      `supplier_ledger_entries` ни в коде, ни в миграциях (кроме REVOKE/триггера запрета);
      исправления — сторно новой записью.
- [ ] **Идемпотентность + correlation ID**: финансовые операции (чек, возврат, оплата,
      смена, проведение документа) и синхронизация принимают idempotency key
      (`UNIQUE (tenant_id, key)`), повтор возвращает исходный результат; correlation ID
      проходит в логи, аудит, problem+json.
- [ ] **Стек соответствует stack.md и accepted ADR; технологии из proposed ADR не используются**:
      нет брокеров (BullMQ/RabbitMQ/Kafka/NATS — до ADR очереди-таблицы по ADR-0002),
      Fastify, другого ORM или мигратора (выбраны Kysely + node-pg-migrate, ADR-0006), pino/winston/OpenTelemetry/Sentry, Vault,
      JWT/OAuth/Passport как стандарта, Vitest; нет внешних SaaS-БД для данных тенантов и
      отправки ПДн/клиентских данных во внешние LLM/SaaS; внешние вызовы — только закрытый
      список (1С файлы, фискализация-адаптер, синхронизация точек); валюта — только TJS,
      без валютных полей и курсов (ADR-0016).

## 2. Безопасность (CRITICAL/HIGH)

- [ ] Каждый маршрут: либо `@RequirePermission('<module>:<action>'[, scope])` с правом **из
      каталога** `libs/shared/domain` (ADR-0018), либо осознанный `@Public()`. Эндпоинт без права — CRITICAL.
- [ ] Точечные ресурсы проверяют охват точек (точка из пути/тела/сессии ∈ охвата); чужой ресурс → 404.
- [ ] Управление ролями и назначениями соблюдает **запрет эскалации**: права ⊆ прав автора,
      охват ⊆ его охвата, свои роль и охват не меняются, «Владельца» назначает только владелец.
- [ ] Изменение роли, прав, охвата или блокировка увеличивает `permissions_version`.
- [ ] **Себестоимость**: закупочная цена, себестоимость и маржа не попадают в ответ без
      `finance:view-cost` (поля отсутствуют в DTO, а не скрываются на клиенте).
- [ ] Сессия «от имени» — только просмотр; изменяющие запросы отклоняются на уровне сессии.
- [ ] Пароли/PIN — только через `PasswordHasher` = scrypt из `node:crypto` + pepper (ADR-0008);
      нет самописной криптографии.
- [ ] Токены сессий и терминала не хранятся в открытом виде (только SHA-256); cookie
      `__Host-sid` / `__Host-op_sid` / `__Host-term`; CSRF-guard на небезопасных методах;
      сессии отзываются при смене пароля/блокировке.
- [ ] Все DTO с `class-validator`, строки с `@MaxLength`, массивы с `@ArrayMaxSize`;
      глобальный `ValidationPipe` с `whitelist` + `forbidNonWhitelisted`.
- [ ] SQL только с параметрами; сортировка — по whitelist.
- [ ] Нет секретов, строк подключения, реальных клиентских данных (в т.ч. в фикстурах).
- [ ] CORS — явный список origin; helmet подключён; Swagger не публичен в проде.
- [ ] ПДн (сотрудники, поставщики, поля рецептов ПКУ), пароли, PIN, токены, лицензионные
      ключи — замаскированы в логах и не попадают в `detail` ошибок.

## 3. Корректность модулей (HIGH)

- [ ] Модуль из утверждённого списка (catalog, inventory, pos, purchasing, pricing, returns,
      billing, sync, fiscal, export-1c, audit); новый модуль — есть ADR.
- [ ] Межмодульное взаимодействие — только через экспортированные сервисы; нет импорта чужих
      репозиториев/таблиц; нет `forwardRef` для обхода циклов.
- [ ] DTO — в `libs/shared/dto`, без импортов `@nestjs/*`; apps не импортируют друг друга.
- [ ] Контроллеры без бизнес-логики; constructor injection; `@Global()` только Config/Core.

## 4. Ошибки и устойчивость (HIGH/MEDIUM)

- [ ] Ошибки — доменные исключения → `ProblemDetailsFilter` → `application/problem+json`
      (RFC 7807); нет ручного формирования ошибок в контроллерах.
- [ ] Unique violation → 409, бизнес-правило → 422, чужое/нет → 404.
- [ ] Нет пустых `catch`, нет «логируем и продолжаем» для финансовых операций.
- [ ] Внешние вызовы (фискализация, синхронизация) — с таймаутом, вне транзакции БД; касса не
      блокируется недоступностью фискализации (очередь-таблица).

## 5. Тесты (HIGH/MEDIUM)

- [ ] Jest-тесты рядом с кодом; новая логика покрыта.
- [ ] Есть тест «тенант A не видит данные тенанта B» для новых путей доступа
      (`*.int-spec.ts`, `npx nx run api:integration`); тест каталога зелёный.
- [ ] Есть тест повтора с тем же idempotency key для финансовых операций.
- [ ] Денежные расчёты и округления покрыты граничными случаями.

## 6. Производительность (MEDIUM)

- [ ] Операция кассы укладывается в ≤ 1 сек: нет N+1, нет HTTP в транзакции, индексы под запросы.
- [ ] Списки — limit/offset с ограничением `limit`, стабильная сортировка, фильтр периода для журналов.
- [ ] Кэш — только там, где он нужен кассе; ключи с `tenantId`.

## 7. Конвенции (MEDIUM/LOW)

- [ ] REST: `/api/v1/…`, ресурсы во множественном числе kebab-case, JSON camelCase.
- [ ] Термины — из глоссария (employee, store, batch, receipt, stock movement…).
- [ ] Логи — встроенный `Logger`, с correlation ID; нет `console.*`.
- [ ] Конфиг — fail-fast; новая переменная есть в `.env.example`.
- [ ] Миграции — node-pg-migrate, `.sql` только Up (вне транзакции — `.mjs` + `noTransaction`),
      без schema-sync; `npx nx run api:db-types-verify` зелёный.

## Формат замечания

```
[CRITICAL] Query without tenant filter
File: apps/api/src/app/inventory/batches.repository.ts:42
Problem: select by batch id only — a batch of another tenant can be read if RLS is misconfigured.
Fix: add `.where('tenantId', '=', tenantId)` and run inside TenantDatabase.tenantTransaction();
     take tenantId from requireTenantId().
```

## Итог ревью

```
## Review Summary
Files reviewed: N
Findings: CRITICAL: n | HIGH: n | MEDIUM: n | LOW: n

### Blocking issues
1. [file:line] — one-line description

### Positive highlights
- ...

VERDICT: [APPROVE|NEEDS_REVIEW|BLOCK] — CRITICAL: N | HIGH: N | MEDIUM: N | LOW: N
```

APPROVE — нет CRITICAL/HIGH; NEEDS_REVIEW — только MEDIUM/LOW; BLOCK — есть CRITICAL или HIGH.

## Справочные файлы скила nestjs-api

Конвенции: `nestjs-conventions.md` · Конфиг: `nestjs-config-basics.md`, `nestjs-config-npm-ts.md`,
`nestjs-config-data-access.md` · Шаблоны: `nestjs-templates-core.md`, `nestjs-templates-features.md`,
`nestjs-templates-infrastructure.md` · Паттерны: `nestjs-enterprise-patterns.md`,
`nestjs-enterprise-infrastructure.md`, `nestjs-rate-limiting.md` · REST: `nestjs-rest-workflow.md`,
`nestjs-rest-dto-pagination.md`, `nestjs-rest-upload-errors.md`, `nestjs-rest-services.md` ·
Безопасность: `nestjs-security-auth.md`, `nestjs-security-scanning.md`,
`nestjs-security-validation-logging.md` · Очереди-таблицы: `nestjs-messaging-basics.md` ·
Логи/контекст: `nestjs-observability.md`, `nestjs-resilience-context.md`,
`nestjs-resilience-circuit-breaker.md` · Тесты: `nestjs-testing-*.md` · Отладка:
`nestjs-debugging-*.md`, `nestjs-real-world-issues.md` · Решения: `nestjs-decision-trees.md`.
