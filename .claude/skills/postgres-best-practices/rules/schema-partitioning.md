---
title: Partition Only When Size or Retention Requires It
impact: MEDIUM
impactDescription: Cheap retention (drop partition) and faster maintenance on the largest append-only tables
tags: partitioning, large-tables, time-series, retention, audit
---

## Partition Only When Size or Retention Requires It

Секционирование усложняет схему (PK и уникальные ограничения обязаны включать ключ секции), а
ввести его потом на таблицу с данными — дорогая миграция, особенно когда та же схема живёт на
офлайн-точках. Поэтому модель данных (`docs/architecture/data-model/`) решила заранее:

- **месячные секции с первого дня** — у самых больших append-only таблиц: `stock_movements`
  (≈ 10–17 млн строк в год, отчёты «на дату», журнал ПКУ), `audit_log` (хранение ≥ 3 лет, затем
  удаление секциями), `sync_inbox` (сырые конверты операций точек);
- ключ — `(tenant_id, id, recorded_at)` (или `received_at`); на секционированные таблицы
  **не ссылаются внешние ключи**, ссылки внутри них (сторно) проверяет приложение;
- секции на год вперёд создаёт плановая задача; старые секции аудита удаляются только по
  регламенту.

Остальные таблицы не секционируются, пока замеры не покажут необходимость.

**Incorrect (секционирование без учёта ограничений):**

```sql
create table audit_log (
  id uuid primary key,              -- ERROR: PK must include the partition key
  occurred_at timestamptz not null
) partition by range (occurred_at);
```

**Correct (ключ секции в PK, секции по месяцам):**

```sql
create table pharmacy.audit_log (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,                                  -- UUIDv7 from the application
  recorded_at timestamptz not null default now(),
  -- ...
  primary key (tenant_id, id, recorded_at)
) partition by range (recorded_at);

create table pharmacy.audit_log_2026_10 partition of pharmacy.audit_log
  for values from ('2026-10-01') to ('2026-11-01');

-- Partitions must be created ahead of time by a scheduled job, otherwise inserts fail.
-- Retention (after ≥ 3 years, per the approved procedure, as the owner role):
alter table audit_log detach partition audit_log_2023_10;
drop table audit_log_2023_10;
```

Учтите:

- Уникальность ключа идемпотентности (`data-idempotency-keys.md`) на секционированной таблице
  возможна только вместе с ключом секции — проектируйте это до секционирования.
- RLS-политики, права и триггеры append-only должны действовать на все секции (задаются на
  родительской таблице; проверить на новых секциях).
- Схема одна для облака и офлайн-точки — секции есть и на точке (там они маленькие и не мешают).
- Секции — тоже таблицы схемы `pharmacy`: манифест `table-classes.ts` перечисляет родителя, тест каталога учитывает `relispartition` (секции наследуют класс родителя).

Reference: [Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
