---
title: Partition Only When Size or Retention Requires It
impact: MEDIUM
impactDescription: Cheap retention (drop partition) and faster maintenance on the largest append-only tables
tags: partitioning, large-tables, time-series, retention, audit
---

## Partition Only When Size or Retention Requires It

Секционирование усложняет схему (PK и уникальные ограничения обязаны включать ключ секции), поэтому
вводится по измерениям, а не заранее. Оценка Pharmacy (stack.md): за 3 года ~5–10 млн чеков и
~30–50 млн движений, до ~100 ГБ с ростом ×5 — для MVP секционирование **не требуется**; хорошие
индексы с ведущим `tenant_id` справляются.

Кандидаты, когда оно понадобится:

- `audit_log`, журнал ПКУ — хранение ≥ 3 лет, затем удаление по регламенту: удалить секцию
  дешевле, чем `DELETE` миллионов строк (и не требует обхода append-only триггера построчно).
- `stock_movements` — если перевалит за ~100 млн строк и отчёты по периодам станут медленными.

**Incorrect (секционирование без учёта ограничений):**

```sql
create table audit_log (
  id uuid primary key,              -- ERROR: PK must include the partition key
  occurred_at timestamptz not null
) partition by range (occurred_at);
```

**Correct (ключ секции в PK, секции по месяцам):**

```sql
create table audit_log (
  id uuid not null,
  tenant_id uuid not null,
  occurred_at timestamptz not null default now(),
  -- ...
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table audit_log_2026_10 partition of audit_log
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
- Офлайн-точке секционирование обычно не нужно, но схема одна — решение принимается для обеих сред.

Reference: [Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
