> **Pharmacy:** адаптировано под стек Pharmacy — без APM/трейсинга (мониторинг пока не выбран — вводится через ADR); логгер — `nestjs-observability.md`, health — `nestjs-enterprise-infrastructure.md`; здесь — диагностика по correlationId, очередям, синхронизации точек и БД. Ограничения: `CLAUDE.md`.

# NestJS Debugging — Production

APM и распределённый трейсинг (OpenTelemetry, Sentry, DataDog и т.п.) — только после ADR о мониторинге (пока не выбран). До этого диагностика опирается на JSON-логи с correlationId, SQL-запросы состояния и внутренние диагностические эндпоинты.

## 1. Найти запрос по correlation ID

Каждый ответ API содержит заголовок `x-correlation-id`; касса показывает/сохраняет его при ошибке. Тот же ID попадает в задачи очереди (`job_queue.correlation_id`) и в операции синхронизации.

```bash
# cloud / offline store (Docker): all records of one request, including background jobs it spawned
docker logs pharmacy-api 2>&1 | grep '"correlationId":"7f3a9c21-...'
```

```sql
SELECT id, type, status, attempts, last_error, run_at
FROM pharmacy.job_queue WHERE correlation_id = $1;
```

## 2. Очереди-таблицы

```sql
-- Depth and age per type/status (columns per data model 06, «Очередь задач»)
SELECT type, status, count(*) AS jobs, min(run_at) AS oldest
FROM pharmacy.job_queue GROUP BY type, status ORDER BY type, status;

-- Dead-letter
SELECT id, tenant_id, type, attempts, last_error, run_at
FROM pharmacy.job_queue WHERE status = 'dead' ORDER BY run_at DESC LIMIT 50;

-- Stuck in processing (worker died): the lease has expired
SELECT id, type, lease_until FROM pharmacy.job_queue
WHERE status = 'processing' AND lease_until < now();
```

Повторный запуск `dead`-задачи — действие оператора в админке с аудитом (`nestjs-messaging-basics.md`), не ручной `UPDATE` в проде.

## 3. Синхронизация офлайн-точек

Операции точки применяются в самом запросе (ADR-0014), «ожидающих применения» в облаке нет.
`sync_inbox` — тенантная таблица: запросы ниже выполняются в tenant-транзакции одного тенанта
(`TenantDatabase.withTenant`), кросс-тенантная сводка для оператора — только через витрину
`store_sync_status` (ADR-0013, класс `tenant-export`, когда появится).

```sql
-- Per store of the current tenant: last accepted operation and quarantine size
SELECT store_id, max(received_at) AS last_received,
       count(*) FILTER (WHERE status = 'quarantined') AS quarantined
FROM pharmacy.sync_inbox
WHERE received_at > now() - interval '7 days'          -- prunes monthly partitions
GROUP BY store_id ORDER BY last_received NULLS FIRST;
```

На точке: глубина локального `sync_outbox`, состояние цепи `sync-upload` (OPEN = нет связи с облаком), срок лицензионного ключа.

## 4. База данных

```sql
-- Long transactions / lock waits (blocking POS receipts)
SELECT pid, now() - xact_start AS xact_age, wait_event_type, state, left(query, 100)
FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY xact_age DESC LIMIT 10;

-- Who blocks whom
SELECT blocked.pid AS blocked_pid, blocking.pid AS blocking_pid, left(blocking.query, 100) AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));
```

Топ медленных запросов — `pg_stat_statements` (`nestjs-debugging-logging.md`).

## 5. Внутренняя диагностика

Публичные `/api/v1/health` и `/api/v1/health/ready` — минимальные (`nestjs-enterprise-infrastructure.md`). Подробности — во внутреннем эндпоинте только для оператора платформы:

```typescript
// apps/api/src/app/platform/diagnostics/diagnostics.controller.ts
@Controller({ path: 'operator/diagnostics', version: '1' })   // /api/v1/operator/diagnostics
// Operator-only diagnostics live in app/platform/** (ADR-0013): operator session + PlatformDatabase
@RequireOperatorPermission('platform:diagnostics')
export class DiagnosticsController {
  constructor(
    private readonly platform: PlatformDatabase,
    private readonly jobs: JobQueueStats,
    private readonly breakers: CircuitBreakerRegistry,
  ) {}

  @Get()
  async get() {
    const mem = process.memoryUsage();
    return {
      uptimeSec: Math.round(process.uptime()),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      dbLatencyMs: await timeMs(() =>                    // timeMs: small helper measuring a promise
        this.platform.platformTransaction({ kind: 'system', job: 'diagnostics' }, async () => undefined)),
      queues: await this.jobs.summary(),            // counts by queue/status, dead count
      circuits: this.breakers.snapshots(),
    };
  }
}
```

Ответ не содержит данных тенантов и ПДн.

## 6. Практики

**Локально:**
- `LOG_LEVEL=debug`, `log_min_duration_statement` в compose PostgreSQL для поиска N+1 и медленных запросов;
- Chrome DevTools / VS Code — профили CPU и heap (`nestjs-debugging-performance.md`).

**Облако и офлайн-точки:**
- JSON-логи с correlationId, tenantId, storeId; ПДн замаскированы;
- health-чеки для оркестрации (`live` без зависимостей, `ready` — БД и Redis);
- медленные запросы — warn по порогу `SLOW_REQUEST_MS` (касса ≤ 1 сек);
- graceful shutdown: `app.enableShutdownHooks()`, воркер очереди перестаёт брать задачи, пул БД и Redis закрываются.

**Нельзя:**
- логировать ПДн, пароли, PIN, сессии, лицензионные ключи, тела запросов;
- выполнять ручные `UPDATE/DELETE` в прод-БД в обход приложения (аудит и журнал ПКУ — append-only);
- подключать внешние APM/SaaS-логгинг без ADR (клиентские данные не уходят во внешние SaaS).
