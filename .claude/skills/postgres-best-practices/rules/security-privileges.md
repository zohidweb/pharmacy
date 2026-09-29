---
title: Separate Owner and Application Roles (Least Privilege)
impact: HIGH
impactDescription: RLS and append-only guarantees hold only if the runtime role is not the table owner
tags: privileges, security, roles, permissions, rls, append-only
---

## Separate Owner and Application Roles (Least Privilege)

Владелец таблицы и superuser обходят RLS (без `FORCE`), могут отключить триггеры и выполнить
`TRUNCATE`. Поэтому `apps/api` в рантайме никогда не подключается владельцем.

Минимальная модель ролей (одинаковая в облаке и в офлайн-дистрибутиве):

| Роль | Назначение | Логин |
|---|---|---|
| `pharmacy_owner` | владеет схемой и таблицами; под ней применяются миграции | только для инструмента миграций |
| `pharmacy_app` | рантайм `apps/api`: DML по нужным таблицам, без DDL | да |
| `pharmacy_readonly` | диагностика/поддержка, только SELECT (с RLS) | по необходимости |

**Incorrect (одна роль на всё):**

```sql
-- App runs as superuser or owner: RLS is bypassed, audit triggers can be disabled
grant all privileges on all tables in schema public to app_user;
grant all privileges on all sequences in schema public to app_user;
create role app_user login password 'secret';   -- password in a migration file
```

**Correct (раздельные роли, точечные права):**

```sql
create role pharmacy_owner nologin;
create role pharmacy_app login nosuperuser nocreatedb nocreaterole nobypassrls;
-- Password is set out of band from the environment/secret store, never in migrations or git

create schema pharmacy authorization pharmacy_owner;
revoke all on schema public from public;
grant usage on schema pharmacy to pharmacy_app;

-- Regular tables: read/write, no TRUNCATE, no DDL
grant select, insert, update, delete on pharmacy.receipts, pharmacy.receipt_lines to pharmacy_app;

-- Append-only tables: insert + select only (see schema-append-only-audit.md)
grant select, insert on pharmacy.stock_movements, pharmacy.audit_log to pharmacy_app;

-- Future objects created by the owner get the same baseline
alter default privileges for role pharmacy_owner in schema pharmacy
  grant select, insert, update, delete on tables to pharmacy_app;
alter default privileges for role pharmacy_owner in schema pharmacy
  grant usage, select on sequences to pharmacy_app;
```

После `alter default privileges` таблицы append-only нужно явно «урезать»
(`revoke update, delete on … from pharmacy_app`) в той же миграции, где они создаются.

Прочее:

- Строки подключения и пароли — только через переменные окружения (`.env` в `.gitignore`,
  в git — `.env.example` без значений). Инструмент управления секретами — категория радара
  «На утверждении», до решения — переменные окружения среды деплоя.
- Пароли ролей БД — механизм `scram-sha-256` PostgreSQL; никакой самописной криптографии.
- Прямой доступ к БД АБС запрещён; внешние SaaS-БД (Supabase Cloud, Neon и т.п.) — запрещены радаром.

Reference: [Privileges](https://www.postgresql.org/docs/current/ddl-priv.html),
[ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)
