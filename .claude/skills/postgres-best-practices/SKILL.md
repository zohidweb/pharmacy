---
name: postgres-best-practices
description: PostgreSQL best practices for the Pharmacy multi-tenant SaaS (pharmacy chains, Tajikistan) — 34 impact-rated rules (CRITICAL→LOW) on plain SQL for the cloud database and the offline store's local PostgreSQL in Docker. Covers tenant isolation (tenant_id everywhere, RLS via current_setting('app.tenant_id') set with SET LOCAL / set_config per transaction, FORCE RLS, non-owner app role), money as bigint dirams, stock derived from batch movements (FEFO, FOR UPDATE, one atomic transaction), idempotency keys for receipts and offline sync (ON CONFLICT DO NOTHING), append-only audit log and ПКУ journal, SKIP LOCKED table queues / outbox instead of message brokers, app-side connection pooling, tenant-leading indexes, RU/TJ catalog search (tsvector russian/simple, pg_trgm, barcodes), VACUUM, EXPLAIN. Use when writing, reviewing or optimizing SQL, schema, migrations or queries in apps/api — касса, чек, склад, партии, остатки, движения, мультитенантность, аудит, синхронизация офлайн-точек.
argument-hint: "[category or specific rule name]"
allowed-tools: Read
context: fork
source: "adapted from kumaran-is/claude-code-onboarding (MIT), develop@a7f2fc5"
metadata:
  triggers: tenant_id, multi-tenant, мультитенантность, RLS row level security, set_config app.tenant_id, SET LOCAL, stock movements, остатки, партии, batches, FEFO, FOR UPDATE, idempotency key, идемпотентность, чек, receipt, money dirams, дирамы, append-only audit, журнал ПКУ, sync queue, outbox, SKIP LOCKED, connection pool, max_connections, deadlock, advisory lock, VACUUM ANALYZE, pg_trgm, full-text search tsvector, штрихкод, JSONB GIN index, pg_stat_statements, EXPLAIN ANALYZE, migrations
  related-skills: nestjs-api
  domain: infrastructure
  role: optimizer
  scope: implementation
  output-format: document
last-reviewed: "2026-09-29"
---

## Pharmacy: контекст и ограничения

Скил адаптирован под Pharmacy — мультитенантную SaaS-платформу автоматизации сети аптек
(3 тенанта, ~30 точек, до 50 одновременных кассиров, рост ×5, операция кассы ≤ 1 сек).
Источник истины: `CLAUDE.md` репозитория `pharmacy` (ADR-0010)
`docs/architecture/stack.md`, `docs/architecture/adr/0002-stil-arhitektury.md`,
`docs/architecture/glossary.md`. При расхождении с этим скилом прав CLAUDE.md/ADR.

**Где работает БД.** PostgreSQL (зафиксирован в stack.md, ADR-0001) — одна облачная БД платформы для всех
тенантов (модульный монолит `apps/api`, ADR-0002) и локальная PostgreSQL офлайн-точки в Docker
(ADR-0005) с **той же схемой и теми же миграциями**. Правила проверяйте для обеих сред.

**Что адаптировано относительно оригинала (Supabase):**

- Убрана вся специфика Supabase (облако, пулер, дашборд, `auth.uid()`, роли `anon`/`authenticated`):
  внешние SaaS-БД для данных тенантов запрещены правилом проекта. Только собственный ванильный PostgreSQL.
- RLS переписан под изоляцию тенантов: `tenant_id` во всех прикладных таблицах,
  `current_setting('app.tenant_id')` + `set_config(..., true)` в транзакции запроса, `FORCE RLS`,
  роль приложения — не владелец.
- Пулинг — на стороне приложения; лимиты посчитаны от нагрузки ТЗ.
- Добавлены доменные правила: деньги в дирамах, остатки из движений, идемпотентность,
  append-only аудит/ПКУ, очереди-таблицы для синхронизации/outbox, поиск по каталогу RU/TJ.

**Не решено → требует ADR через `/03-adr` до использования:**

- ORM / слой доступа к данным (Prisma, TypeORM, Drizzle, Kysely…) и драйвер — примеры в скиле
  на чистом SQL, без привязки к библиотеке.
- Инструмент миграций — «фиксируется первым ADR разработки»; миграции версионированные,
  никакого schema-sync в проде.
- PgBouncer или любой внешний пулер — отдельный компонент инфраструктуры.
- Производный кэш остатков (если замеры покажут, что агрегация движений не укладывается в SLA).
- Модель ролей для кросс-тенантных путей (биллинг оператора, воркер очередей всех тенантов).

**Нельзя:** брокеры сообщений без ADR (по ADR-0002 очереди — таблицы с `SKIP LOCKED`, пока ADR
не пересмотрит решение); внешние SaaS-БД для данных тенантов (правило проекта); системы
мониторинга (Prometheus/Grafana/OTel…) — не выбраны, вводятся через ADR, встроенные `pg_stat_*` —
можно; секреты в миграциях и в git.

## Iron Law

NEVER TUNE WHAT YOU HAVEN'T MEASURED — CHECK `pg_stat_statements` AND `pg_stat_activity` BEFORE
CHANGING CONFIGURATION OR ADDING INDEXES. И второй закон Pharmacy: **ни одного запроса к
прикладной таблице без `tenant_id` и без транзакции с контекстом тенанта.**

## When to Use This Skill

- Проектирование таблиц и миграций `apps/api` (чеки, партии, движения, документы, аудит, очереди)
- Ревью SQL/миграций на изоляцию тенантов, инварианты остатков и денег, идемпотентность
- Запись чека / проведение документа: блокировки партий, FEFO, атомарность
- Очередь синхронизации офлайн-точек и outbox фоновых задач (`SKIP LOCKED`)
- Поиск по каталогу препаратов (RU/TJ, МНН, штрихкод, опечатки)
- Размер пула, лимиты соединений и таймауты — облако и ПК офлайн-точки
- Диагностика медленных запросов (EXPLAIN под ролью приложения, pg_stat_statements, VACUUM)

## Do Not Use This Skill When

- Нужна структура NestJS-модулей, DTO, контроллеры — `nestjs-api`
- Нужно выбрать ORM, инструмент миграций, пулер — это не рецепт, а решение: сначала `/03-adr`
- Вопрос про другую СУБД — нужно обоснование в stack.md + отдельный ADR

Ревью миграций и SQL можно поручить агенту `postgresql-database-reviewer`, передав ему этот скил
как чек-лист.

## Критичные правила Pharmacy (читать первыми)

| Правило | Суть |
|---|---|
| `rules/security-rls-basics.md` | `tenant_id` везде, `ENABLE`+`FORCE RLS`, политика через `current_setting('app.tenant_id')`, составные FK `(tenant_id, id)` |
| `rules/conn-session-state.md` | Контекст тенанта — только `set_config(..., true)` в транзакции; сессионный `SET` на пуле = утечка между тенантами |
| `rules/data-stock-from-movements.md` | Остаток = сумма движений; `FOR UPDATE` партий по `id`, FEFO, документ/чек и движения — одна транзакция |
| `rules/data-idempotency-keys.md` | `unique (tenant_id, idempotency_key)`, `ON CONFLICT DO NOTHING RETURNING` как «ворота», `sync_inbox` |
| `rules/schema-money-integer.md` | Деньги — `bigint` в дирамах, `CHECK (>= 0)` где уместно, округление себестоимости вверх |
| `rules/query-missing-indexes.md` | Индексы горячих путей кассы и склада с ведущим `tenant_id` |

## Rule Categories by Priority

34 правила (в оригинале заявлено 33, фактически было 30 файлов; добавлено 4 новых).

| Priority | Category | Prefix | Rules | CRITICAL |
|---|---|---|---|---|
| 1 | Security & Tenant Isolation | `security-` | 3 | rls-basics |
| 2 | Data Integrity & Access Patterns | `data-` | 6 | stock-from-movements, idempotency-keys |
| 3 | Schema Design | `schema-` | 7 | money-integer |
| 4 | Query Performance | `query-` | 5 | missing-indexes |
| 5 | Connection Management | `conn-` | 4 | session-state |
| 6 | Concurrency & Locking | `lock-` | 4 | — |
| 7 | Monitoring & Diagnostics | `monitor-` | 3 | — |
| 8 | Advanced Features | `advanced-` | 2 | — |

Описание разделов — `rules/_sections.md`, формат нового правила — `rules/_template.md`.

## Quick Rule Index

### Security & Tenant Isolation
- `rules/security-rls-basics.md` — CRITICAL — tenant_id, FORCE RLS, `app.tenant_id`, составные FK
- `rules/security-rls-performance.md` — HIGH — политика = одно равенство `(select current_setting(...))`, индексы с ведущим tenant_id, права — в приложении
- `rules/security-privileges.md` — HIGH — роли `pharmacy_owner` / `pharmacy_app` / `pharmacy_readonly`, default privileges, секреты вне миграций

### Data Integrity & Access Patterns
- `rules/data-stock-from-movements.md` — CRITICAL — остатки из движений, FEFO + `FOR UPDATE`, атомарность
- `rules/data-idempotency-keys.md` — CRITICAL — ключи идемпотентности чеков и синхронизации
- `rules/data-n-plus-one.md` — MEDIUM-HIGH — пакетная загрузка строк чека (`= any($n::uuid[])`)
- `rules/data-batch-inserts.md` — MEDIUM — `unnest`-вставки, `COPY FROM STDIN`, staging-импорт
- `rules/data-pagination.md` — MEDIUM — REST limit/offset с пределом; keyset для выгрузок 1С и синхронизации
- `rules/data-upsert.md` — MEDIUM — upsert только для справочников/настроек/цен, не для документов

### Schema Design
- `rules/schema-money-integer.md` — CRITICAL — `bigint` дирамы, без float/`money`/`numeric(…,2)`
- `rules/schema-append-only-audit.md` — HIGH — аудит, журнал ПКУ, движения: `REVOKE` + триггер-запрет
- `rules/schema-primary-keys.md` — HIGH — UUIDv7 из приложения для сущностей офлайн-точек
- `rules/schema-data-types.md` — HIGH — `timestamptz`, `date` для сроков годности, штрихкоды `text`
- `rules/schema-foreign-key-indexes.md` — HIGH — индексы составных FK, диагностический запрос
- `rules/schema-lowercase-identifiers.md` — MEDIUM — snake_case в БД, camelCase в JSON, имена из глоссария
- `rules/schema-partitioning.md` — MEDIUM — на MVP не нужно; кандидаты — аудит (retention), движения

### Query Performance
- `rules/query-missing-indexes.md` — CRITICAL — горячие пути кассы/склада
- `rules/query-composite-indexes.md` — HIGH — tenant_id первым, равенства → диапазон
- `rules/query-index-types.md` — HIGH — B-tree / GIN / GiST / BRIN
- `rules/query-partial-indexes.md` — HIGH — черновики, очередь, «одна открытая смена»
- `rules/query-covering-indexes.md` — MEDIUM-HIGH — `INCLUDE (qty)` для остатка партии

### Connection Management
- `rules/conn-session-state.md` — CRITICAL — никакого сессионного состояния на пуле
- `rules/conn-pooling.md` — HIGH — пул в приложении, расчёт от 50×5 кассиров и числа инстансов; PgBouncer — ADR
- `rules/conn-limits.md` — HIGH — `max_connections`, таймауты на роль; облако vs ПК точки
- `rules/conn-idle-timeout.md` — MEDIUM — `idle_in_transaction_session_timeout`, не рвать пул

### Concurrency & Locking
- `rules/lock-skip-locked.md` — HIGH — очередь синхронизации / outbox на `SKIP LOCKED`, lease, backoff
- `rules/lock-deadlock-prevention.md` — MEDIUM-HIGH — блокировка партий одним запросом `order by id`
- `rules/lock-short-transactions.md` — MEDIUM-HIGH — фискализация, курсы НБТ, HTTPS — вне транзакции
- `rules/lock-advisory.md` — MEDIUM — `pg_advisory_xact_lock` по точке

### Monitoring & Diagnostics
- `rules/monitor-vacuum-analyze.md` — MEDIUM — autovacuum для append-only и очередей
- `rules/monitor-pg-stat-statements.md` — LOW-MEDIUM — топ запросов, бюджет кассы
- `rules/monitor-explain-analyze.md` — LOW-MEDIUM — планы под `pharmacy_app` с контекстом тенанта

### Advanced Features
- `rules/advanced-full-text-search.md` — MEDIUM — каталог RU/TJ: `russian`/`simple`, pg_trgm, штрихкоды, локаль БД
- `rules/advanced-jsonb-indexing.md` — LOW — JSONB только для расширяемых атрибутов

## Интеграция с NestJS (`apps/api`)

- Слой доступа к данным (выбирается ADR) обязан предоставлять **один** способ работы с
  прикладными таблицами — транзакцию с контекстом тенанта; tenant берётся из серверной сессии
  (Redis) или из лицензионного ключа точки, никогда из тела запроса.
- Контроллеры не ходят в БД; сервис модуля вызывает хелпер транзакции; внешние вызовы — до или
  после неё (`lock-short-transactions.md`).
- Ошибки БД мапятся в RFC 7807: дубль по ключу идемпотентности (пустой `RETURNING`) → вернуть
  сохранённый результат, тот же ключ с другим `request_hash` → 409/422;
  `40P01`/`55P03` → ограниченный повтор транзакции; нехватка остатка → 409/422 с понятным текстом.

Иллюстрация контракта (не выбор библиотеки: `Db`/`Tx` — интерфейсы будущего слоя доступа):

```ts
export interface Tx {
  query<T>(sql: string, params: readonly unknown[]): Promise<T[]>;
}
export interface Db {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function withTenantTx<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // is_local = true: context lives only until COMMIT/ROLLBACK (see conn-session-state.md)
    await tx.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(tx);
  });
}
```

Тесты (Jest, `npx nx test api`; интеграционные — `npx nx e2e api-e2e`) на реальной PostgreSQL
обязательно покрывают: изоляцию тенантов под ролью приложения, параллельную продажу одной партии,
повтор чека с тем же ключом идемпотентности, запрет UPDATE/DELETE в аудите.

## Related Skills

- `nestjs-api` — структура модулей, сервисов и DTO `apps/api`
