---
title: Use an Application-Side Connection Pool Sized from Real Load
impact: HIGH
impactDescription: Stable latency for 50 → 250 concurrent cashiers without exhausting max_connections
tags: connection-pooling, pool-size, stateless, nestjs, pgbouncer, offline
---

## Use an Application-Side Connection Pool Sized from Real Load

Соединение PostgreSQL — отдельный процесс (несколько МБ RAM, дорогое установление). Соединение
«на каждый запрос» под нагрузкой кассы исчерпает `max_connections` и добавит десятки мс к каждой
операции. В Pharmacy пулинг — **на стороне приложения**: `pg.Pool` внутри Kysely в каждом
stateless-инстансе `apps/api` (ADR-0006, `apps/api/src/core/database/pool.ts`). Пулов **два**
(ADR-0013): tenant (`pharmacy_app`, `application_name = api-tenant`, `DB_POOL_MAX`, по умолчанию
10) и platform (`pharmacy_platform`, `api-platform`, `PLATFORM_DB_POOL_MAX`, 3; на офлайн-точке
1–2). Пулы создаются лениво — при первой транзакции.

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
tenant_pool ≈ 10, platform_pool ≈ 3   -- start here, adjust by measurement (pg_stat_activity)
total = api_instances × (tenant_pool + platform_pool)
      + migrate service / maintenance (≈ 5)
      + superuser_reserved_connections (3)
total ≤ max_connections × 0.8          -- keep headroom

cloud example:   3 instances × (10 + 3) + 5 + 3 = 47   → max_connections = 100
offline store:   1 instance  × (5 + 2)  + 2 + 3 = 12   → max_connections = 30
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

- Таймаут ожидания свободного соединения из пула — `DB_CONNECTION_TIMEOUT_MS`
  (`connectionTimeoutMillis`), ошибка — в RFC 7807, а не бесконечное ожидание.
- Ошибки простаивающих соединений ловит `pool.on('error')` (иначе процесс падает) — лог без
  строки подключения.
- Любая работа с данными тенанта — внутри транзакции с `set_config('app.tenant_id', …, true)`;
  сессионное состояние на пуловом соединении запрещено (см. `conn-session-state.md`).

**PgBouncer / внешний пулер** — отдельный компонент инфраструктуры, в `stack.md` его нет:
использование **требует ADR через `/03-adr`**. При нагрузке ТЗ (×5) он не нужен. Если ADR его
введёт в transaction mode — действуют ограничения из `conn-session-state.md` (никаких
сессионных `SET`, сессионных advisory-локов, `LISTEN`, временных таблиц между транзакциями).

Reference: [Connections and Authentication](https://www.postgresql.org/docs/current/runtime-config-connection.html)
