---
title: Write Migrations as Forward-Only SQL That Carries Isolation and Grants
impact: HIGH
impactDescription: A migration without RLS, grants or a table class silently opens or breaks tenant isolation in the cloud and on every offline store
tags: migrations, node-pg-migrate, rls, grants, backfill, offline-store
---

## Write Migrations as Forward-Only SQL That Carries Isolation and Grants

Миграции — node-pg-migrate (ADR-0006): файлы `apps/api/migrations/<timestamp>_<name>.sql`,
применяет роль `pharmacy_owner` скриптом `apps/api/scripts/migrate.mjs` (dev —
`npx nx run api:migrate`; test/prod — сервис `migrate` в compose до старта API; офлайн-точка —
тот же скрипт из образа после `pg_dump`). Одна цепочка миграций — для облака и всех офлайн-точек.

Обязательные правила:

1. **Только Up.** Секции `-- Down Migration` нет; откат — новой миграцией или из бэкапа.
2. **Транзакция.** Каждый `.sql` выполняется в транзакции. `CREATE INDEX CONCURRENTLY` и другие
   операции вне транзакции — отдельной `.mjs`-миграцией с `pgm.noTransaction()`.
3. **Изоляция в той же миграции:** таблица по модели данных (ключ `(tenant_id, id)`, `id` без
   `default`, составные ссылки), `enable` + `force row level security`, политики с явным
   `TO <роль>` в fail-closed форме, **явные гранты по классу таблицы** (default privileges для
   `pharmacy_app` нет) и запись в `apps/api/src/core/database/table-classes.ts` в том же PR. Тест
   каталога (`catalog.int-spec.ts`) падает, если что-то из этого забыто.
4. **FORCE RLS действует и на владельца.** `pharmacy_owner` не обходит RLS: бэкфилл данных в
   тенантной таблице без контекста видит 0 строк и ничего не меняет. Бэкфилл выполняется по
   тенантам: `select set_config('app.tenant_id', <tenant>, true)` и затем `UPDATE` в той же
   транзакции — или отдельной разовой задачей «по тенанту в цикле» (ADR-0013 §4).
5. **Совместимость с офлайн-точками** (ADR-0014): точки обновляются не одновременно —
   expand/contract: сначала добавить (nullable-колонка, новая таблица), потом переключить код,
   потом удалить старое отдельной миграцией.
6. **Ревью.** Каждую миграцию проверяет агент `postgresql-database-reviewer`; затем
   `npx nx run api:db-types` и `npx nx run api:db-types-verify`.

**Incorrect (новая таблица без изоляции и прав, бэкфилл без контекста):**

```sql
-- Up Migration
create table pharmacy.categories (
  id uuid primary key default gen_random_uuid(),   -- generated in the DB: offline stores collide (docs-check: ok)
  tenant_id uuid not null,
  name text not null
);
-- no RLS, no policy, no grants: pharmacy_app gets "permission denied" (or worse, a later
-- "grant all" opens TRUNCATE, which ignores RLS)

update pharmacy.products set category_id = null;    -- as the owner under FORCE RLS: 0 rows updated
-- Down Migration
drop table pharmacy.categories;                     -- not used in this project
```

**Correct:**

```sql
-- Up Migration
create table pharmacy.categories (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,                                 -- newId() (UUIDv7) from the application
  name jsonb not null check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  markup_bp integer check (markup_bp >= 0),
  pos_sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

alter table pharmacy.categories enable row level security;
alter table pharmacy.categories force row level security;
create policy tenant_isolation on pharmacy.categories for all to pharmacy_app
  using      (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.categories to pharmacy_app;
-- + `categories: 'tenant'` in table-classes.ts in the same PR
```

```js
// apps/api/migrations/<timestamp>_products-name-trgm-index.mjs — outside a transaction
export const up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`create index concurrently if not exists products_name_ru_trgm
             on pharmacy.products using gin ((name->>'ru') pharmacy.gin_trgm_ops)`);
};
```

Reference: [node-pg-migrate](https://salsita.github.io/node-pg-migrate/), ADR-0006, ADR-0013,
`docs/architecture/data-model/README.md`.
