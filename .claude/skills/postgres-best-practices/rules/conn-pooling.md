---
title: Use an Application-Side Connection Pool Sized from Real Load
impact: HIGH
impactDescription: Stable latency for 50 → 250 concurrent cashiers without exhausting max_connections
tags: connection-pooling, pool-size, stateless, nestjs, pgbouncer, offline
---

## Use an Application-Side Connection Pool Sized from Real Load

Соединение PostgreSQL — отдельный процесс (несколько МБ RAM, дорогое установление). Соединение
«на каждый запрос» под нагрузкой кассы исчерпает `max_connections` и добавит десятки мс к каждой
операции. В Pharmacy пулинг — **на стороне приложения**: пул драйвера/ORM внутри каждого
stateless-инстанса `apps/api` (ORM и драйвер не выбраны — **требует ADR через `/03-adr`**).

**Incorrect (соединение на запрос / пул «на глаз»):**

```sql
-- Each HTTP request opens and closes its own connection
select count(*) from pg_stat_activity where datname = 'pharmacy';   -- 300+ during peak

-- Or: pool max = 100 per API instance "to be safe"; 4 instances = 400 > max_connections
```

**Correct (расчёт от нагрузки ТЗ):**

Нагрузка: до 50 одновременных кассиров, запас ×5 → **~250**. Операция кассы — короткая транзакция
(≈ 10–50 мс в БД) раз в несколько секунд на кассира, т.е. одновременно активных транзакций —
единицы, а не сотни. Пул нужен, чтобы держать пики и отчёты, а не «по соединению на кассира».

```
per_instance_pool_max ≈ 10            -- start here, adjust by measurement (pg_stat_activity)
total = api_instances × per_instance_pool_max
      + sync/queue workers + migrations/maintenance (≈ 5)
      + superuser_reserved_connections (3)
total ≤ max_connections × 0.8          -- keep headroom

cloud example:   3 instances × 10 + 5 + 5 + 3 = 43   → max_connections = 100
offline store:   1 instance  × 5  + 2 + 3     = 10   → max_connections = 30
```

Ориентир верхней границы активных соединений для самой БД — `(CPU cores × 2) + дисков`; больше
активных запросов, чем ядер, не ускоряет, а замедляет. Добавление инстансов API (ADR-0002: масштаб
горизонтальный) — пересчитать `total` до деплоя.

```sql
-- Measure, don't guess: how many connections are actually busy at peak?
select state, count(*) from pg_stat_activity
where datname = current_database() and usename = 'pharmacy_app'
group by state;
```

Правила для пула в `apps/api`:

- Таймаут ожидания свободного соединения из пула — короче SLA кассы (например, 2–3 с), ошибка —
  в RFC 7807, а не бесконечное ожидание.
- Любая работа с данными тенанта — внутри транзакции с `set_config('app.tenant_id', …, true)`;
  сессионное состояние на пуловом соединении запрещено (см. `conn-session-state.md`).

**PgBouncer / внешний пулер** — отдельный компонент инфраструктуры, в `stack.md` его нет:
использование **требует ADR через `/03-adr`**. При нагрузке ТЗ (×5) он не нужен. Если ADR его
введёт в transaction mode — действуют ограничения из `conn-session-state.md` (никаких
сессионных `SET`, сессионных advisory-локов, `LISTEN`, временных таблиц между транзакциями).

Reference: [Connections and Authentication](https://www.postgresql.org/docs/current/runtime-config-connection.html)
