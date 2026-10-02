---
title: Separate Owner and Application Roles (Least Privilege)
impact: HIGH
impactDescription: RLS and append-only guarantees hold only if the runtime role is not the table owner
tags: privileges, security, roles, permissions, rls, append-only
---

## Separate Owner and Application Roles (Least Privilege)

Владелец таблицы и superuser обходят RLS (без `FORCE`), могут отключить триггеры и выполнить
`TRUNCATE`. Поэтому `apps/api` в рантайме никогда не подключается владельцем.

Модель ролей — ADR-0013 (одинаковая в облаке и на офлайн-точке; создаётся
`docker/postgres/initdb/01-roles.sh`, `BYPASSRLS` — только у суперпользователя образа):

| Роль | Атрибуты | Назначение |
|---|---|---|
| `pharmacy_owner` | LOGIN, `NOBYPASSRLS`, владелец БД и схемы | только миграции (`apps/api/scripts/migrate.mjs`, сервис `migrate`) |
| `pharmacy_app` | LOGIN, `NOBYPASSRLS`, не член других ролей | рантайм tenant-пути: HTTP клиентского продукта, «от имени», задачи тенантов |
| `pharmacy_platform` | LOGIN, `NOBYPASSRLS`, отдельный пароль | рантайм платформы: `/api/v1/operator/*`, платформенные задачи; права только на платформенные таблицы, витрины и колонки реестра `stores` |
| `pharmacy_resolver` | NOLOGIN, `NOBYPASSRLS` | владелец SECURITY DEFINER-резолверов (код сети, лицензионный ключ, терминал, сессия офлайн-точки) |
| `pharmacy_readonly` | по необходимости | диагностика с RLS |

**Incorrect (одна роль на всё):**

```sql
-- App runs as superuser or owner: RLS is bypassed, audit triggers can be disabled
grant all privileges on all tables in schema public to app_user;
grant all privileges on all sequences in schema public to app_user;
create role app_user login password 'secret';   -- password in a migration file
```

**Correct (раздельные роли, точечные права):**

```sql
-- initdb (superuser), passwords from env — never in migrations or git
create role pharmacy_owner    login nosuperuser nocreatedb nocreaterole nobypassrls password :'owner_pw';
create role pharmacy_app      login nosuperuser nocreatedb nocreaterole nobypassrls password :'app_pw';
create role pharmacy_platform login nosuperuser nocreatedb nocreaterole nobypassrls password :'platform_pw';
create role pharmacy_resolver nologin nosuperuser nocreatedb nocreaterole nobypassrls;
grant pharmacy_resolver to pharmacy_owner;            -- migrations may hand functions over to the resolver

-- 02-database.sql (as pharmacy_owner)
revoke all on schema public from public;
create schema pharmacy;
grant usage on schema pharmacy to pharmacy_app, pharmacy_platform, pharmacy_resolver;
grant create on schema pharmacy to pharmacy_resolver;  -- ALTER FUNCTION … OWNER TO pharmacy_resolver
alter default privileges for role pharmacy_owner revoke execute on functions from public;
-- NO default privileges for pharmacy_app: a new platform table must never get DML silently

-- Every migration grants explicitly by table class (ADR-0013 §1):
grant select, insert, update, delete on pharmacy.receipts, pharmacy.receipt_lines to pharmacy_app;  -- tenant
grant select, insert on pharmacy.stock_movements, pharmacy.audit_log to pharmacy_app;               -- append-only
grant select, insert, update on pharmacy.license_keys to pharmacy_platform;                         -- platform
```

Тест каталога (`catalog.int-spec.ts`) сверяет **точные** наборы прав по ролям и классам таблиц:
лишний `TRUNCATE` (обходит RLS), `REFERENCES`, `TRIGGER` или `MAINTAIN` у рантайм-роли — падение.

Резолвер (SECURITY DEFINER) — только поиск по точному равенству уникального ключа или хеша,
результат — идентификаторы и статус:

```sql
create function pharmacy.resolve_license_key(p_key_hash bytea)
returns table (tenant_id uuid, store_id uuid, status text, valid_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select k.tenant_id, k.store_id, k.status, k.valid_until
  from pharmacy.license_keys k                    -- fully qualified: pg_temp is searched first otherwise
  where k.key_hash = p_key_hash
$$;
alter function pharmacy.resolve_license_key(bytea) owner to pharmacy_resolver;
revoke all on function pharmacy.resolve_license_key(bytea) from public;
grant execute on function pharmacy.resolve_license_key(bytea) to pharmacy_app;
```

Прочее:

- Строки подключения и пароли — только через переменные окружения (`.env` в `.gitignore`,
  в git — `.env.example` без значений). Хранилище секретов не выбрано — вводится
  через ADR; до него — env-файлы / переменные окружения среды деплоя.
- Пароли ролей БД — механизм `scram-sha-256` PostgreSQL; никакой самописной криптографии.
- Внешние SaaS-БД (Supabase Cloud, Neon и т.п.) для данных тенантов запрещены правилом проекта —
  только собственная PostgreSQL.

Reference: [Privileges](https://www.postgresql.org/docs/current/ddl-priv.html),
[ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)
