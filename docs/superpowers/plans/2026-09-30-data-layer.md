# Слой данных apps/api (Kysely, миграции, RLS, роли БД) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать `apps/api` единственный путь к данным: tenant-транзакцию Kysely под RLS и отдельный платформенный путь без `BYPASSRLS`. Первая миграция создаёт реестр тенантов и точек и таблицы авторизации. Изоляцию проверяют тесты каталога и поведения на реальной PostgreSQL.

**Architecture:** Два пула `pg` с разными ролями (`pharmacy_app` / `pharmacy_platform`) обёрнуты в Kysely с `CamelCasePlugin`. `TenantDatabase.withTenant()` первым оператором транзакции выставляет `app.tenant_id` и таймауты через `set_config(…, true)`. Миграции — SQL-файлы node-pg-migrate (только Up), их применяет роль `pharmacy_owner` через один скрипт `apps/api/scripts/migrate.mjs`, общий для dev, тестов и Docker. Типы БД генерирует `kysely-codegen` из мигрированной схемы. Интеграционные тесты (`*.int-spec.ts`) пересоздают схему в отдельной БД `pharmacy_test` и прогоняют миграции.

**Tech Stack:** NestJS 11, `kysely` 0.29.6, `pg` 8.23.0, `node-pg-migrate` 9.0.0, `kysely-codegen` 0.20.0, `@types/pg` 8.23.1, PostgreSQL 17 (`docker/postgres`), Jest + SWC.

**Spec:**
- `docs/architecture/data-model/` — физическая модель данных (схема первой миграции — `01-platform-org.md`);
- `docs/architecture/adr/0006-orm-i-migracii.md` — правила 1–9;
- `docs/architecture/adr/0013-krosstenantnyj-dostup.md` — классы таблиц, роли, п. 7 «Правило для кода», п. 8 «Тесты изоляции»;
- `docs/architecture/adr/0018-model-avtorizacii.md` — п. 2–3, 7: `roles`, `role_permissions`, `employee_stores`, `permissions_version`;
- `docs/architecture/adr/0009-instrumenty-testirovaniya-i-porogi-kachestva.md` — ось А: PostgreSQL из compose, отдельная БД `pharmacy_test`;
- `CLAUDE.md` («Conventions», «Containers»).

## Global Constraints

- Версии закреплены точно (без `^`): `kysely` 0.29.6, `pg` 8.23.0, `node-pg-migrate` 9.0.0 — в `dependencies` проекта `apps/api`; `kysely-codegen` 0.20.0, `@types/pg` 8.23.1 — в `devDependencies`.
- Ни одна рантайм-роль не получает `BYPASSRLS`. `pharmacy_app` и `pharmacy_platform` — `LOGIN NOBYPASSRLS`, `pharmacy_resolver` — `NOLOGIN NOBYPASSRLS`, `pharmacy_owner` — только миграции.
- Tenant-политика — только в fail-closed форме: `using/with check (tenant_id = (select current_setting('app.tenant_id')::uuid))`, без `missing_ok`. Все политики — с явным `TO <роль>`, политик `TO public` нет.
- id — UUIDv7 от приложения (`newId()`, ADR-0014 §2), без `default` в БД; у таблиц класса `tenant` первичный ключ `(tenant_id, id)`, ссылки внутри тенанта составные. Схема таблиц — `docs/architecture/data-model/` (одобрена архитектором 2026-09-30).
- `ENABLE` + `FORCE ROW LEVEL SECURITY` на каждой таблице классов `tenant`, `tenant-export`, `platform`, `system`.
- Default privileges для `pharmacy_app` не выдаются. Гранты — явно в миграции по классу таблицы. `alter default privileges for role pharmacy_owner revoke execute on functions from public`.
- Миграции — `apps/api/migrations/*.sql`, только Up (без `-- Down Migration`). Таблица журнала — `public.pgmigrations`, схема `pharmacy` содержит только прикладные таблицы.
- Имена в БД — `snake_case`, в коде — `camelCase` (`CamelCasePlugin`, `kysely-codegen --camel-case`).
- Type parser пула — свой `types` для каждого пула, не глобальный: `int8 (oid 20) → BigInt`, `date (oid 1082) → строка YYYY-MM-DD`. В codegen тот же маппинг.
- Raw SQL — только тег `sql` с параметрами; `sql.raw`/`sql.lit` со входными данными запрещены.
- Классы таблиц — в манифесте `apps/api/src/core/database/table-classes.ts`, он сверяется с `pg_catalog` в обе стороны.
- Типы БД — `apps/api/src/core/database/db.generated.ts`, не в `libs/shared/*`.
- `PlatformDatabase` доступен только коду в `apps/api/src/app/platform/**` и `apps/api/src/app/sync/**`.
- Секреты — только в env-файлах вне git. В `.env.example` и `docker/env/*.env.example` — плейсхолдеры `change-me…`.
- Полный прогон `npm run check` запускает пользователь (память проекта); в шагах — проверки одного проекта. Удаление docker-томов и правка локального `.env` — только после подтверждения пользователя.

**Вне плана** (следующие планы):
- план аутентификации и авторизации: каталог прав в `libs/shared/domain`, хеширование, сессии, guards;
- резолверы `SECURITY DEFINER`, `job_queue`, `platform_audit_log`, `TenantJobRunner`, `OperatorSessionGuard`;
- логирование SQL с маскированием параметров, сериализация `bigint` в DTO;
- CI-job интеграционных тестов и `db-types-verify` как гейт (план C);
- обновление скилов (план D).

## Review Focus

1. Соединение из пула, на котором только что прошла tenant-транзакция A, отдаётся запросу без контекста или с контекстом B. Ожидание: ошибка без контекста и 0 строк A под B. Тест `does not leak the tenant to the next transaction on a reused connection` (Task 6, пул `max: 1`).
2. Интеграционный стенд настроен на dev-БД и делает `drop schema pharmacy cascade` на рабочих данных. Ожидание: setup отказывается, если имя тестовой БД совпадает с БД из `DATABASE_URL`. Тест `rejects a test database equal to the dev database` (Task 3).
3. Сумма в дирамах больше 2^53 теряет точность при чтении. Ожидание: `int8` приходит как `bigint` без потерь. Тест парсера с `9007199254740993` (Task 1) и `typeof permissionsVersion === 'bigint'` (Task 6).
4. Ошибка или таймаут внутри `work` оставляет транзакцию открытой или соединение занятым. Ожидание: ROLLBACK, соединение возвращается в пул. Тесты `rolls back and releases the connection when work throws` и `applies statement_timeout` (Task 6, пул `max: 1`).
5. Новая таблица добавлена миграцией без записи в манифест, без RLS или с лишними грантами. Ожидание: тест каталога падает с именем таблицы (Task 4).

---

### Task 1: Зависимости, env и пул `pg`

**Files:**
- Modify: `apps/api/package.json` (зависимости), `package-lock.json`
- Modify: `apps/api/src/app/config/env.validation.ts`, `apps/api/src/app/config/env.validation.spec.ts`
- Create: `apps/api/src/core/database/pool.ts`, `apps/api/src/core/database/pool.spec.ts`

**Interfaces:**
- Produces:
  - `pgTypes: CustomTypesConfig` и `createPool(options: PoolOptions): Pool`, где `PoolOptions = { connectionString: string; applicationName: string; max: number; connectionTimeoutMillis: number }`;
  - обработчик `pool.on('error')` пишет в `Logger` без строки подключения;
  - переменные env: `DATABASE_URL`, `PLATFORM_DATABASE_URL` (обязательные, `postgres://` или `postgresql://`), `DB_POOL_MAX` (по умолчанию 10), `PLATFORM_DB_POOL_MAX` (3), `DB_STATEMENT_TIMEOUT_MS` (5000), `DB_LOCK_TIMEOUT_MS` (2000), `DB_CONNECTION_TIMEOUT_MS` (5000).

- [ ] **Step 1: Установить зависимости**

Run: `npm install -E -w @pharmacy/api kysely@0.29.6 pg@8.23.0 node-pg-migrate@9.0.0` и `npm install -E -D -w @pharmacy/api kysely-codegen@0.20.0 @types/pg@8.23.1`
Expected: версии без `^` в `apps/api/package.json`. Лицензии — MIT (`node -e` по `package.json` пакета). `npm audit` не показывает новых high/critical от этих пакетов.

- [ ] **Step 2: Тесты env**

В `env.validation.spec.ts` тест «applies defaults when variables are absent» переписать: вызывать с `{ DATABASE_URL: 'postgres://u:p@h:5432/d', PLATFORM_DATABASE_URL: 'postgres://u:p@h:5432/d' }` и ожидать `DB_POOL_MAX: 10, PLATFORM_DB_POOL_MAX: 3, DB_STATEMENT_TIMEOUT_MS: 5000, DB_LOCK_TIMEOUT_MS: 2000, DB_CONNECTION_TIMEOUT_MS: 5000` вместе с прежними значениями по умолчанию. Остальные тесты тоже передают обе URL. Новые тесты:

```ts
it('requires DATABASE_URL and PLATFORM_DATABASE_URL', () => {
  expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
});
it('rejects a non-postgres DATABASE_URL', () => {
  expect(() => validateEnv({ ...urls, DATABASE_URL: 'mysql://x' })).toThrow(/Invalid environment configuration/);
});
it('converts DB_STATEMENT_TIMEOUT_MS from a string', () => {
  expect(validateEnv({ ...urls, DB_STATEMENT_TIMEOUT_MS: '1500' }).DB_STATEMENT_TIMEOUT_MS).toBe(1500);
});
```

- [ ] **Step 3: Тесты пула** — `pool.spec.ts`:

```ts
it('parses int8 into bigint without precision loss', () => {
  expect(pgTypes.getTypeParser(20, 'text')('9007199254740993')).toBe(9007199254740993n);
});
it('keeps date as a YYYY-MM-DD string', () => {
  expect(pgTypes.getTypeParser(1082, 'text')('2026-09-30')).toBe('2026-09-30');
});
it('leaves other types to pg defaults', () => {
  expect(pgTypes.getTypeParser(23, 'text')('42')).toBe(42);
});
it('passes application_name, max and connection timeout to the pool', () => {
  const pool = createPool({ connectionString: 'postgres://u:p@127.0.0.1:1/d', applicationName: 'api-tenant', max: 2, connectionTimeoutMillis: 100 });
  expect(pool.options).toMatchObject({ application_name: 'api-tenant', max: 2, connectionTimeoutMillis: 100 });
  return pool.end();
});
```

- [ ] **Step 4: Запустить — должны упасть**

Run: `npx nx test api --skip-nx-cache`
Expected: FAIL — `Cannot find module './pool'`, тесты env падают на новых полях.

- [ ] **Step 5: Реализовать** поля env (`@Matches(/^postgres(ql)?:\/\//)`, `@Type(() => Number) @IsInt() @Min(1)` с умолчаниями) и `pool.ts`. `pgTypes` — объект `{ getTypeParser(oid, format) }`: для 20 и 1082 свои парсеры, иначе `types.getTypeParser` из `pg`. Обновить комментарий в начале `env.validation.ts`.

- [ ] **Step 6: Запустить — должны пройти**

Run: `npx nx test api --skip-nx-cache`
Expected: PASS, все тесты api.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/app/config apps/api/src/core/database/pool.ts apps/api/src/core/database/pool.spec.ts
git commit -m "feat(api): pg pool with bigint/date parsers and database env (ADR-0006)"
```

---

### Task 2: Образ PostgreSQL — роли ADR-0013, владелец БД, `pharmacy_test`

**Files:**
- Replace: `docker/postgres/initdb/01-roles-and-schema.sh` → `docker/postgres/initdb/01-roles.sh` (суперпользователь) + `docker/postgres/initdb/02-database.sql` (выполняется от `pharmacy_owner`)
- Modify: `docker/compose.yml`, `docker/compose.dev.yml`, `.env.example`, `docker/env/test.env.example`, `docker/env/prod.env.example`

**Interfaces:**
- Produces:
  - роли `pharmacy_owner`, `pharmacy_app`, `pharmacy_platform` (пароль `PHARMACY_PLATFORM_PASSWORD`), `pharmacy_resolver` (NOLOGIN);
  - `search_path = pharmacy` у owner/app/platform;
  - `grant pharmacy_resolver to pharmacy_owner`;
  - БД `POSTGRES_DB` принадлежит `pharmacy_owner`;
  - при заданной `PHARMACY_TEST_DATABASE` — пустая БД с этим именем, владелец `pharmacy_owner`;
  - файл `02-database.sql` — идемпотентная для пустой БД подготовка схемы. Task 3 выполняет его же в `pharmacy_test`.

- [ ] **Step 1: `01-roles.sh`** — по образцу текущего скрипта, `set -eu`, пароли обязательны (`: "${PHARMACY_PLATFORM_PASSWORD:?…}"`). SQL: создание четырёх ролей с атрибутами из Global Constraints, `alter role … set search_path = pharmacy` (owner, app, platform), `grant pharmacy_resolver to pharmacy_owner`, `alter database :"db" owner to pharmacy_owner`. Если `PHARMACY_TEST_DATABASE` задана — `create database :"test_db" owner pharmacy_owner`. Блок `alter default privileges … to pharmacy_app` не переносится.

- [ ] **Step 2: `02-database.sql`**

```sql
-- Runs as pharmacy_owner (initdb: via SET ROLE; tests: connected as the owner). Empty database only.
set role pharmacy_owner;
revoke all on schema public from public;
create schema pharmacy;
grant usage on schema pharmacy to pharmacy_app, pharmacy_platform, pharmacy_resolver;
grant create on schema pharmacy to pharmacy_resolver;  -- ALTER FUNCTION … OWNER TO pharmacy_resolver (ADR-0013)
alter default privileges for role pharmacy_owner revoke execute on functions from public;
create extension if not exists pg_trgm schema pharmacy;  -- catalog search RU/TJ
```

- [ ] **Step 3: Compose и env-примеры**
  - `compose.yml`: у `postgres` добавить `PHARMACY_PLATFORM_PASSWORD: ${PHARMACY_PLATFORM_PASSWORD:?set in the env file}` и `PHARMACY_TEST_DATABASE: ${PHARMACY_TEST_DATABASE:-}`; у `api` — `PLATFORM_DATABASE_URL: postgres://pharmacy_platform:${PHARMACY_PLATFORM_PASSWORD}@postgres:5432/${POSTGRES_DB:-pharmacy}`; убрать комментарий «Used once the data layer…».
  - `compose.dev.yml`: у `postgres` `environment: { PHARMACY_TEST_DATABASE: pharmacy_test }`.
  - `.env.example`: `PHARMACY_PLATFORM_PASSWORD=change-me-local-only`; раскомментировать `DATABASE_URL`; добавить `PLATFORM_DATABASE_URL`, `MIGRATION_DATABASE_URL` (роль `pharmacy_owner`), `TEST_DATABASE_NAME=pharmacy_test` — хост `127.0.0.1:5432`, БД `pharmacy`.
  - `test.env.example`, `prod.env.example`: `PHARMACY_PLATFORM_PASSWORD=change-me`.

- [ ] **Step 4: СТОП — подтверждение пользователя.** initdb выполняется только на пустом томе, поэтому нужно:
  - пересоздать dev-том PostgreSQL: `docker compose … down` и удалить том `pharmacy-dev_pg-data` (и test-том, если он есть);
  - добавить в локальный `.env` строки из шага 3 со своими паролями.

  Показать пользователю команды и дождаться явного «да». Без него — не удалять.

- [ ] **Step 5: Проверить роли**

Run: `npm run dev:deps`, затем `docker compose --project-name pharmacy-dev --env-file .env -f docker/compose.yml -f docker/compose.dev.yml exec postgres psql -U postgres -d pharmacy -Atc "<запрос>"`
Expected:
- `select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname like 'pharmacy_%' order by 1` → четыре роли, у всех `rolbypassrls = f`, у `pharmacy_resolver` `rolcanlogin = f`;
- `select datname, pg_get_userbyid(datdba) from pg_database where datname in ('pharmacy','pharmacy_test')` → обе, владелец `pharmacy_owner`;
- `select count(*) from pg_default_acl` → `1` (только revoke execute).

- [ ] **Step 6: Commit**

```bash
git add docker .env.example
git commit -m "feat(docker): database roles for platform and resolver paths, test database (ADR-0013, ADR-0009)"
```

---

### Task 3: Мигратор и стенд интеграционных тестов

**Files:**
- Create: `apps/api/scripts/migrate.mjs`, `apps/api/migrations/.gitkeep`
- Create: `apps/api/jest.integration.config.cts`, `apps/api/test/integration/{database-urls.ts,database-urls.spec.ts,global-setup.ts,connections.ts}`, `apps/api/src/core/database/stand.int-spec.ts`
- Modify: `apps/api/package.json` (таргеты `migrate`, `integration`), `apps/api/tsconfig.app.json` (exclude `src/**/*.int-spec.ts`), `apps/api/tsconfig.spec.json` (include `src/**/*.int-spec.ts`, `test/**/*.ts`)

**Interfaces:**
- Produces:
  - `node apps/api/scripts/migrate.mjs` — применяет все миграции из `MIGRATIONS_DIR` (по умолчанию `../migrations` от файла скрипта) к `MIGRATION_DATABASE_URL` через `runner` из `node-pg-migrate`. Параметры: `direction: 'up'`, `migrationsTable: 'pgmigrations'`, `migrationsSchema: 'public'`, `checkOrder: true`, advisory-лок включён. Без URL — выход с кодом 1 и сообщением без секретов;
  - `testDatabaseUrls(env: NodeJS.ProcessEnv): { owner: string; app: string; platform: string; name: string }` — URL из `MIGRATION_DATABASE_URL` / `DATABASE_URL` / `PLATFORM_DATABASE_URL` с именем БД, заменённым на `TEST_DATABASE_NAME` (по умолчанию `pharmacy_test`);
  - `connections.ts`: `appPool()`, `platformPool()`, `ownerPool()` — `createPool` из Task 1 на URL тестовой БД; `closeAll()`;
  - `npx nx run api:migrate`, `npx nx run api:integration` (`cache: false`).

- [ ] **Step 1: Тест `database-urls.spec.ts`**

```ts
const env = {
  DATABASE_URL: 'postgres://pharmacy_app:a@127.0.0.1:5432/pharmacy',
  PLATFORM_DATABASE_URL: 'postgres://pharmacy_platform:p@127.0.0.1:5432/pharmacy',
  MIGRATION_DATABASE_URL: 'postgres://pharmacy_owner:o@127.0.0.1:5432/pharmacy',
};
it('points every role at the test database', () => {
  const urls = testDatabaseUrls(env);
  expect(urls.name).toBe('pharmacy_test');
  expect(new URL(urls.app).pathname).toBe('/pharmacy_test');
  expect(new URL(urls.owner).username).toBe('pharmacy_owner');
});
it('rejects a test database equal to the dev database', () => {
  expect(() => testDatabaseUrls({ ...env, TEST_DATABASE_NAME: 'pharmacy' })).toThrow(/must differ/);
});
it('fails when a URL is missing', () => {
  expect(() => testDatabaseUrls({ ...env, PLATFORM_DATABASE_URL: undefined })).toThrow(/PLATFORM_DATABASE_URL/);
});
```

- [ ] **Step 2: Запустить** `npx nx test api --skip-nx-cache` — Expected: FAIL, `Cannot find module './database-urls'`. Реализовать `database-urls.ts`, повторить — PASS.

- [ ] **Step 3: Проверить API мигратора.** `npx node-pg-migrate --help` и типы `runner` в `node_modules/node-pg-migrate`. Имена опций, поддержку `.sql` и режим «только Up» не угадывать, а сверить. Расхождение с Interfaces — ruling в ledger.

- [ ] **Step 4: Реализовать** `migrate.mjs`, `global-setup.ts` и `jest.integration.config.cts`.
  - `global-setup.ts` (владельцем, в `pharmacy_test`):
    1. `drop schema if exists pharmacy cascade; drop table if exists public.pgmigrations;`
    2. выполнить `docker/postgres/initdb/02-database.sql`;
    3. запустить `node apps/api/scripts/migrate.mjs` (`spawnSync`, `MIGRATION_DATABASE_URL` = `owner`); ненулевой код — бросить исключение.
  - `jest.integration.config.cts`: копия `jest.config.cts` с `testMatch: ['<rootDir>/src/**/*.int-spec.ts']`, `globalSetup`, `displayName: 'api-integration'`, `testTimeout: 30000`.
  - Таргеты в `apps/api/package.json`:
    - `migrate`: `nx:run-commands`, `node apps/api/scripts/migrate.mjs`;
    - `integration`: `@nx/jest:jest`, `jestConfig: apps/api/jest.integration.config.cts`, `runInBand: true`, `cache: false`.

- [ ] **Step 5: Тест стенда** `stand.int-spec.ts`:

```ts
it('connects as pharmacy_app with the pharmacy schema on the search path', async () => {
  const { rows } = await appPool().query("select current_user as u, current_setting('search_path') as sp, current_database() as db");
  expect(rows[0]).toEqual({ u: 'pharmacy_app', sp: 'pharmacy', db: 'pharmacy_test' });
});
it('records migrations in public.pgmigrations', async () => {
  const { rows } = await ownerPool().query("select to_regclass('public.pgmigrations') as t");
  expect(rows[0].t).toBe('pgmigrations');
});
```

Run: `npx nx run api:integration` (dev-зависимости подняты, `.env` из Task 2)
Expected: PASS, 2 теста. Повторный запуск тоже PASS: стенд пересоздаётся.

- [ ] **Step 6: Проверить dev-мигратор** — `npx nx run api:migrate`. Expected: «No migrations to run», код 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/scripts apps/api/migrations apps/api/jest.integration.config.cts apps/api/test apps/api/src/core/database/stand.int-spec.ts apps/api/package.json apps/api/tsconfig.app.json apps/api/tsconfig.spec.json
git commit -m "build(api): node-pg-migrate runner and integration test stand on pharmacy_test (ADR-0006, ADR-0009)"
```

---

### Task 4: Первая миграция — организация сети по модели данных; манифест классов

**Spec этой задачи:**
- `docs/architecture/data-model/README.md` — соглашения и «Порядок миграций», п. 1;
- `docs/architecture/data-model/01-platform-org.md` — колонки, типы, проверки и индексы таблиц.

Схему таблиц брать **оттуда**; здесь — только решения, которых там нет.

**Files:**
- Create: `apps/api/migrations/<timestamp>_org-foundation.sql` — через `npx node-pg-migrate create org-foundation --migration-file-language sql -m apps/api/migrations`, секцию Down удалить
- Create: `apps/api/src/core/database/ids.ts`, `apps/api/src/core/database/ids.spec.ts`
- Create: `apps/api/src/core/database/table-classes.ts`
- Create: `apps/api/src/core/database/catalog.int-spec.ts`, `apps/api/src/core/database/isolation.int-spec.ts`
- Create: `apps/api/test/integration/seed.ts` — `seedTenant(code: string): Promise<{ tenantId: string; legalEntityId: string; storeId: string }>`: тенант под `pharmacy_platform`, юрлицо и точка под `pharmacy_app` в контексте тенанта, id — `newId()`
- Modify: `apps/api/package.json`, `package-lock.json` — `uuid` 14.0.2 в `dependencies` (точная версия, MIT; UUIDv7 — ADR-0014 §2)

**Interfaces:**
- Produces:
  - `newId(): string` — UUIDv7 (`v7` из `uuid`); единственный генератор id приложения;
  - `type TableClass = 'tenant' | 'tenant-export' | 'platform' | 'shared' | 'system'`;
  - `TABLE_CLASSES: Readonly<Record<string, TableClass>>` = `{ tenants: 'platform', tenant_settings: 'tenant', legal_entities: 'tenant', stores: 'tenant', employees: 'tenant', employee_credentials: 'tenant', roles: 'tenant', role_permissions: 'tenant', employee_stores: 'tenant', terminals: 'tenant' }`;
  - `RESOLVER_FUNCTIONS: readonly string[]` = `[]` (ADR-0013 п. 3; резолверы — в следующих планах);
  - `STORE_PLATFORM_COLUMNS` = `['id','tenant_id','name','mode','status','created_at','closed_at']`.

Решения миграции (дополняют 01-platform-org.md):
- **`id` без `default`:** id генерирует приложение (`newId()`).
- **Первичные ключи:**
  - таблицы класса `tenant` — `(tenant_id, id)`;
  - `tenant_settings` — `tenant_id`;
  - `employee_credentials` — `(tenant_id, employee_id)`;
  - `role_permissions` — `(tenant_id, role_id, permission)`;
  - `employee_stores` — `(tenant_id, employee_id, store_id)`.
- **Ссылки внутри тенанта** — составные: `(tenant_id, x_id) references t (tenant_id, id)`. `tenant_id` каждой таблицы — `references tenants (id)`.
- **`roles.name`** — `jsonb` с `check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb)` (D6).
- **Индексы** — под каждый составной внешний ключ, который не покрыт ведущими колонками первичного или уникального ключа.
- **Права.** Политики — с `to <роль>`, у каждой таблицы `enable` + `force row level security`:

| Таблица | `pharmacy_app` | `pharmacy_platform` |
|---|---|---|
| `tenants` | `select` + `tenant_self_read for select using (id = (select current_setting('app.tenant_id')::uuid))` | `select, insert, update` + `platform_all using (true) with check (true)` |
| `stores` | DML + `tenant_isolation` | `select` колонок `STORE_PLATFORM_COLUMNS` + `platform_registry_read for select using (true)`; `update (mode)` + `platform_store_mode for update using (true) with check (true)` |
| остальные восемь | DML + `tenant_isolation` | нет |

`tenant_isolation` — политика из Global Constraints с `to pharmacy_app`.

- [ ] **Step 1: Тест `ids.spec.ts`:**
  - `newId()` возвращает UUID версии 7 (`/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`);
  - два вызова подряд дают возрастающие строки (`a < b`).

- [ ] **Step 2: Тест каталога `catalog.int-spec.ts`** — под `ownerPool()`, отдельный `it` на каждое правило ADR-0013 п. 8, сообщение перечисляет нарушителей:
  - `every table in schema pharmacy is in TABLE_CLASSES and vice versa` (`pg_class`, `relkind in ('r','p')`);
  - `RLS is enabled and forced on tenant, tenant-export, platform and system tables`;
  - `pharmacy_app has no insert/update/delete on platform tables`;
  - `pharmacy_platform has no table privileges on tenant tables and only the registry columns of stores`:
    - `has_table_privilege` (`select/insert/update/delete`) = false;
    - `has_column_privilege(…, 'select')` true ровно для `STORE_PLATFORM_COLUMNS`;
    - `update` — только `mode`;
  - `only superusers bypass RLS`;
  - `security definer functions are exactly the resolver list` — владелец `pharmacy_resolver`, `search_path=` в `proconfig`, нет `EXECUTE` у `PUBLIC`;
  - `pharmacy_app is not a member of pharmacy_platform or pharmacy_resolver`;
  - `no policy targets public, tenant policies target pharmacy_app`;
  - `no default privileges grant anything to pharmacy_app`;
  - `every tenant-class table has tenant_id leading its primary key` — по `pg_index` / `pg_attribute`: первая колонка PK — `tenant_id` для всех таблиц класса `tenant`;
  - `no id column has a default` — `pg_attrdef` для колонок `id`: пусто.

- [ ] **Step 3: Тест поведения `isolation.int-spec.ts`** — тенанты A и B из `seedTenant`. Хелпер `asTenant(tenantId, fn)` на `appPool()`: `begin; select set_config('app.tenant_id', $1, true); …; rollback|commit`. Кейсы:
  - `app: reads and updates of another tenant's rows affect 0 rows` — `stores` и `legal_entities` B из контекста A;
  - `app: insert with another tenant_id violates the policy` — `42501`;
  - `app: a query without tenant context fails` — `42704` или `22P02`;
  - `app: sees only its own tenants row and cannot insert tenants` — 1 строка; `insert` → `42501`;
  - `app: composite FK rejects a store of another tenant in employee_stores` — сотрудник A, `store_id` B → `23503`;
  - `app: composite FK rejects a legal entity of another tenant in stores` — `23503`;
  - `platform: tenant tables are not readable` — `select * from roles` и `select * from employee_credentials` → `42501`;
  - `platform: store registry columns are readable, address is not` — `select id, name, mode from stores` видит A и B; `select address from stores` → `42501`;
  - `platform: may change store mode only` — `update stores set mode = 'offline'` → 1 строка; `update stores set name = 'x'` → `42501`.

- [ ] **Step 4: Запустить — должны упасть**

Run: `npx nx test api --skip-nx-cache` и `npx nx run api:integration`
Expected:
- FAIL: `Cannot find module './ids'` / `'./table-classes'`;
- после создания модулей — таблиц ещё нет, тест каталога называет отсутствующие таблицы.

- [ ] **Step 5: Реализовать** `ids.ts`, манифест и миграцию по 01-platform-org.md и решениям выше. Миграция — один `.sql`: таблицы, индексы, RLS, политики, гранты. Ревью миграции — агент `postgresql-database-reviewer` (ADR-0006 п. 7); замечания Critical/Important — исправить до коммита.

- [ ] **Step 6: Запустить — должны пройти**

Run: `npx nx test api --skip-nx-cache` и `npx nx run api:integration`
Expected: PASS — `ids`, `stand`, `catalog` (11) и `isolation` (9).

- [ ] **Step 7: Применить к dev-БД** — `npx nx run api:migrate`. Expected: применена 1 миграция, повторный запуск — «No migrations to run».

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/migrations apps/api/src/core/database/ids.ts apps/api/src/core/database/ids.spec.ts apps/api/src/core/database/table-classes.ts apps/api/src/core/database/*.int-spec.ts apps/api/test/integration/seed.ts
git commit -m "feat(api): first migration — tenant organization per the data model, table classes (ADR-0013, ADR-0018)"
```

---

### Task 5: Типы БД — kysely-codegen

**Files:**
- Create: `apps/api/.kysely-codegenrc.json`, `apps/api/src/core/database/db.generated.ts` (генерируется), `apps/api/src/core/database/db-types.spec.ts`
- Modify: `apps/api/package.json` (таргеты `db-types`, `db-types-verify`), `apps/api/eslint.config.mjs` (ignore `src/core/database/db.generated.ts`)

**Interfaces:**
- Consumes: мигрированная dev-БД (Task 4, Step 6), `MIGRATION_DATABASE_URL`.
- Produces:
  - `DB` из `db.generated.ts` — интерфейс с ключами `tenants`, `stores`, `roles`, `rolePermissions`, `employees`, `employeeStores` (без префикса схемы);
  - `npx nx run api:db-types` пишет файл, `npx nx run api:db-types-verify` — код ≠ 0 при дрифте.

- [ ] **Step 1: Тест `db-types.spec.ts`** — читает `db.generated.ts` как текст:

```ts
it('maps int8 to bigint (same as the pool type parser)', () => {
  expect(source).toMatch(/permissionsVersion: Generated<bigint>/);
  expect(source).not.toMatch(/Int8/);
});
it('uses camelCase table keys without schema prefix and skips pgmigrations', () => {
  expect(source).toMatch(/employeeStores: EmployeeStores;/);
  expect(source).not.toMatch(/pharmacy\.|pgmigrations/);
});
```

- [ ] **Step 2: Запустить** `npx nx test api --skip-nx-cache` — Expected: FAIL, `ENOENT … db.generated.ts`.

- [ ] **Step 3: Конфиг и таргеты.** Сверить имена опций с `npx kysely-codegen --help`. Опции:
  - `dialect: 'postgres'`, `camelCase: true`;
  - `url: 'env(MIGRATION_DATABASE_URL)'` — роль с `USAGE` и видимостью всех таблиц;
  - `defaultSchemas: ['pharmacy']`, `includePattern: 'pharmacy.*'`;
  - `typeMapping: { int8: 'bigint', date: 'string' }`;
  - `outFile: 'src/core/database/db.generated.ts'`.

  Таргеты — `nx:run-commands` с `cwd: apps/api`: `kysely-codegen` и `kysely-codegen --verify`. Опция, которой нет в 0.20, — ruling в ledger.

- [ ] **Step 4: Сгенерировать и проверить**

Run: `npx nx run api:db-types`, затем `npx nx test api --skip-nx-cache` и `npx nx run api:db-types-verify`
Expected: тесты PASS; verify — код 0. После ручной порчи файла verify — код ≠ 0, файл восстановить.

- [ ] **Step 5: Commit**

```bash
git add apps/api/.kysely-codegenrc.json apps/api/src/core/database/db.generated.ts apps/api/src/core/database/db-types.spec.ts apps/api/package.json apps/api/eslint.config.mjs
git commit -m "build(api): kysely-codegen types from the migrated schema (ADR-0006)"
```

---

### Task 6: `TenantDatabase`, `PlatformDatabase`, контекст запроса

**Files:**
- Create: `apps/api/src/common/context/request-context.ts`, `apps/api/src/common/context/request-context.spec.ts`
- Create: `apps/api/src/core/database/{database-settings.ts,tenant-database.ts,database.module.ts,index.ts,tenant-database.int-spec.ts}`
- Create: `apps/api/src/core/database/platform/{platform-database.ts,platform-database.module.ts,index.ts,platform-database.int-spec.ts}`
- Modify: `apps/api/src/app/app.module.ts` (импорт `DatabaseModule`)

**Interfaces:**
- Consumes:
  - `createPool`, env — Task 1;
  - `DB` — Task 5;
  - `seedTenant`, пулы тестов — Tasks 3–4.
- Produces:
  - `request-context.ts`:
    - `RequestContext = { correlationId: string; tenantId?: string }`;
    - `requestContextStorage`, `getRequestContext()`, `requireTenantId(): string`;
    - `TenantContextMissingError` с сообщением `Tenant context is missing`;
    - `runWithContext<T>(ctx, fn: () => T): T`;
  - `DatabaseSettings = { url: string; poolMax: number; statementTimeoutMs: number; lockTimeoutMs: number; connectionTimeoutMs: number }`, `TENANT_DATABASE_SETTINGS`, `PLATFORM_DATABASE_SETTINGS` — injection tokens;
  - `TenantTransaction = Transaction<DB>`;
  - `class TenantDatabase implements OnModuleDestroy`:
    - `constructor(settings: DatabaseSettings)`, `application_name = 'api-tenant'`;
    - `withTenant<T>(tenantId: string, work: (trx: TenantTransaction) => Promise<T>): Promise<T>`;
    - `tenantTransaction<T>(work): Promise<T>` = `withTenant(requireTenantId(), work)`;
    - `onModuleDestroy(): Promise<void>`;
  - `DatabaseModule` — `@Global()`, экспортирует только `TenantDatabase`;
  - `PlatformActor = { kind: 'operator'; operatorId: string } | { kind: 'system'; job: string }`;
  - `class PlatformDatabase`:
    - `application_name = 'api-platform'`;
    - `platformTransaction<T>(actor: PlatformActor, work: (trx: Transaction<DB>) => Promise<T>): Promise<T>`;
  - `PlatformDatabaseModule` — не `@Global`, экспортирует `PlatformDatabase`;
  - `core/database/index.ts` экспортирует `TenantDatabase`, `DatabaseModule`, `TenantTransaction`, `DB`; пул и `Kysely` наружу не экспортируются.

Первый оператор транзакции — один запрос: `select set_config('app.tenant_id', ${tenantId}, true), set_config('statement_timeout', ${ms}, true), set_config('lock_timeout', ${ms}, true)`. У платформы вместо тенанта — `set_config('app.actor', 'operator:<id>' | 'system:<job>', true)`. `tenantId` и `operatorId` проверяются как UUID. `job` проверяется по `^[a-z0-9.-]{1,64}$`. Невалидное значение — исключение до обращения к БД.

- [ ] **Step 1: Unit-тесты контекста** — `request-context.spec.ts`:
  - `requireTenantId throws TenantContextMissingError outside a context`;
  - `returns the tenant set by runWithContext`;
  - `runWithContext isolates nested contexts`: внешний контекст не меняется после вложенного.

- [ ] **Step 2: Интеграционные тесты `tenant-database.int-spec.ts`** — `new TenantDatabase({ url: testDatabaseUrls(process.env).app, poolMax: 1, statementTimeoutMs: 200, lockTimeoutMs: 100, connectionTimeoutMs: 2000 })`:
  - `sets app.tenant_id and timeouts as the first statements`: внутри `work` — `current_setting('app.tenant_id')` = A, `statement_timeout` = `200ms`, `lock_timeout` = `100ms`;
  - `returns camelCase rows and int8 as bigint`: `selectFrom('employees').select(['fullName', 'permissionsVersion'])` → `typeof permissionsVersion === 'bigint'`; сотрудник создаётся в том же тесте;
  - `sees only the rows of its tenant`: `selectFrom('stores')` в контексте A не содержит точку B;
  - `rolls back and releases the connection when work throws`: вставка роли, затем throw. Роли нет, следующий `withTenant` на пуле из 1 соединения выполняется;
  - `does not leak the tenant to the next transaction on a reused connection`: `withTenant(A)`, затем на том же пуле из 1 соединения `withTenant(B)`. Внутри B `current_setting('app.tenant_id')` = B, а в `stores` нет строк A. Сценарий «без контекста» покрывает `isolation.int-spec.ts`;
  - `applies statement_timeout`: `sql\`select pg_sleep(1)\`` → ошибка `57014`;
  - `rejects an invalid tenant id before touching the database`: `withTenant('x', …)` → throw, `work` не вызван;
  - `tenantTransaction uses the tenant from the request context and fails without it`.

- [ ] **Step 3: Интеграционные тесты `platform-database.int-spec.ts`**:
  - `sets app.actor for an operator`;
  - `sets app.actor for a system job`;
  - `rejects a missing or malformed actor`: `undefined`, `{ kind: 'operator', operatorId: 'x' }`, `{ kind: 'system', job: 'Bad Job' }`;
  - `reads the store registry and is denied tenant tables`: `stores` — видны A и B; `roles` → `42501`.

- [ ] **Step 4: Запустить — должны упасть**

Run: `npx nx test api --skip-nx-cache` и `npx nx run api:integration`
Expected: FAIL — модулей нет (`Cannot find module`).

- [ ] **Step 5: Реализовать.**
  - Kysely: `new Kysely<DB>({ dialect: new PostgresDialect({ pool: createPool(…) }), plugins: [new CamelCasePlugin()] })`, `db.transaction().execute(async (trx) => …)`.
  - Модули собирают `DatabaseSettings` из `ConfigService` (`DATABASE_URL`, `DB_POOL_MAX`, … / `PLATFORM_DATABASE_URL`, `PLATFORM_DB_POOL_MAX`, …).
  - `DatabaseModule` подключить в `AppModule`. `PlatformDatabaseModule` пока никем не импортируется.

- [ ] **Step 6: Запустить — должны пройти**

Run: `npx nx test api --skip-nx-cache`, `npx nx run api:integration`, `npx nx build api`, `npx nx lint api`
Expected: всё PASS. `npx nx serve api` стартует с `.env` без поднятой БД — пул ленивый; `GET /api/v1/health` → 200.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common apps/api/src/core/database apps/api/src/app/app.module.ts
git commit -m "feat(api): TenantDatabase.withTenant and PlatformDatabase.platformTransaction on Kysely (ADR-0006, ADR-0013)"
```

---

### Task 7: Граница платформенного пути и прямого доступа к пулу

**Files:**
- Create: `apps/api/src/core/database/architecture.spec.ts`
- Modify: `apps/api/eslint.config.mjs`

**Interfaces:**
- Consumes: пути из Task 6.
- Produces: `findDataAccessViolations(files: { path: string; source: string }[]): string[]`. Экспорт — из самого spec-файла или `apps/api/test/architecture.ts`. Правила:
  1. импорт `core/database/platform` вне `src/app/platform/**`, `src/app/sync/**`, `src/core/database/**`;
  2. `new Kysely(`, `new Pool(` или импорт из `'pg'` вне `src/core/database/**`;
  3. импорт внутренних файлов `core/database/*` в обход `index.ts` вне `src/core/database/**`.

  Пути — относительно `apps/api`.

- [ ] **Step 1: Тест `architecture.spec.ts`**
  - на синтетических файлах — по одному нарушению каждого правила и по одному разрешённому случаю;
  - `apps/api/src has no data access violations` — рекурсивный обход `src/**/*.ts` (без `*.spec.ts`, `*.int-spec.ts`) → `[]`.

- [ ] **Step 2: Запустить** `npx nx test api --skip-nx-cache` — Expected: FAIL, функции нет.

- [ ] **Step 3: Реализовать** сканер (регулярные выражения по импортам и `new X(`).

  В `eslint.config.mjs` — блок `{ files: ['src/**/*.ts'], ignores: ['src/core/database/**', 'src/app/platform/**', 'src/app/sync/**', 'src/**/*.spec.ts', 'src/**/*.int-spec.ts'], rules: { 'no-restricted-imports': ['error', { paths: [{ name: 'pg', message: … }], patterns: [{ group: ['**/core/database/platform', '**/core/database/platform/*'], message: … }, { group: ['**/core/database/*', '!**/core/database/index'], message: … }] }] } }`. Шаблоны проверить временной фикстурой — как в плане A. Сообщения:
  - `ADR-0013: PlatformDatabase is available only in app/platform/** and app/sync/**.`
  - `ADR-0006: use TenantDatabase from core/database; no direct pg access.`
  - `ADR-0006: import core/database through its index.`

- [ ] **Step 4: Запустить** `npx nx test api --skip-nx-cache` и `npx nx lint api`. Expected: PASS. Временная фикстура `src/app/pos/probe.ts` с `import { PlatformDatabase } from '../../core/database/platform'` даёт ошибку ESLint с сообщением ADR-0013 и падение теста `apps/api/src has no data access violations`. Фикстуру удалить.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/database/architecture.spec.ts apps/api/eslint.config.mjs
git commit -m "test(api): enforce platform and data-access boundaries (ADR-0013, ADR-0006)"
```

---

### Task 8: Миграции в Docker и документация

**Files:**
- Modify: `apps/api/webpack.config.js` (assets: `./scripts/migrate.mjs` → `scripts/`, `./migrations/**` → `migrations/`)
- Modify: `docker/compose.yml` (сервис `migrate`; `api.depends_on.migrate: service_completed_successfully`)
- Modify: `CLAUDE.md` («Build / test / lint», «Containers», «Environments»)

**Interfaces:**
- Consumes: `migrate.mjs` (Task 3), миграции (Task 4).
- Produces: `npm run stack -- <test|prod> up` применяет миграции ролью `pharmacy_owner` до старта API (ADR-0006 п. 8).

- [ ] **Step 1: Сборка образа содержит мигратор**

Run: `npx nx run api:prune --configuration=production`
Expected:
- в `apps/api/dist/` есть `scripts/migrate.mjs` и `migrations/<timestamp>_authz-foundation.sql`;
- `apps/api/dist/package.json` содержит `node-pg-migrate`, `pg`, `kysely`.

Если prune не переносит `node-pg-migrate` — найти причину, решение записать как ruling.

- [ ] **Step 2: Сервис `migrate`** в `compose.yml`:
  - `image: pharmacy/api:${IMAGE_TAG:-local}`, `command: ['node', 'scripts/migrate.mjs']`;
  - `environment: { MIGRATION_DATABASE_URL: postgres://pharmacy_owner:${PHARMACY_OWNER_PASSWORD}@postgres:5432/${POSTGRES_DB:-pharmacy} }`;
  - `depends_on: postgres: service_healthy`, `restart: 'no'`, `logging: *logging`.

  `PHARMACY_OWNER_PASSWORD` попадает только в этот сервис.

- [ ] **Step 3: Проверить в среде test**

Run: `npm run test-env:build`, затем `npm run test-env:up`
Expected:
- `migrate` завершился с кодом 0, `api` — healthy;
- в `pgmigrations` 1 строка: `docker compose … exec postgres psql -U postgres -d pharmacy -Atc "select name from public.pgmigrations"`;
- если `up --wait` не принимает завершившийся one-shot сервис — ruling с проверенным решением.

Затем `npm run test-env:down`.

- [ ] **Step 4: CLAUDE.md**
  - «Build / test / lint»: строки `npx nx run api:migrate` (миграции dev-БД ролью owner), `npx nx run api:integration` (интеграционные тесты на `pharmacy_test`, нужен `npm run dev:deps`), `npx nx run api:db-types` / `db-types-verify`;
  - «Containers»: API подключается ролями `pharmacy_app` (tenant-путь) и `pharmacy_platform` (только `app/platform/**`, `app/sync/**`); `pharmacy_owner` — только сервис `migrate`; роли `pharmacy_resolver` (NOLOGIN); БД принадлежит `pharmacy_owner`;
  - «Environments»: `PHARMACY_PLATFORM_PASSWORD` в env-файлах; существующие тома требуют пересоздания (initdb только на пустом томе).

- [ ] **Step 5: Commit**

```bash
git add apps/api/webpack.config.js docker/compose.yml CLAUDE.md
git commit -m "build: run migrations as pharmacy_owner before the API in docker (ADR-0006)"
```

- [ ] **Step 6: Попросить пользователя запустить полный прогон** — `npm run check`. Expected: все проекты зелёные.
