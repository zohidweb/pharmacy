> **Pharmacy:** адаптировано под стек Pharmacy — без APM/трейсинга (категория «Мониторинг» на утверждении); логгер — `nestjs-observability.md`, health — `nestjs-enterprise-infrastructure.md`; здесь — диагностика по correlationId, очередям, синхронизации точек и БД. Ограничения: `CLAUDE.md`.

# NestJS Debugging — Production

APM и распределённый трейсинг (OpenTelemetry, Sentry, DataDog и т.п.) — только после утверждения категории радара + ADR. До этого диагностика опирается на JSON-логи с correlationId, SQL-запросы состояния и внутренние диагностические эндпоинты.

## 1. Найти запрос по correlation ID

Каждый ответ API содержит заголовок `x-correlation-id`; касса показывает/сохраняет его при ошибке. Тот же ID попадает в задачи очереди (`job_queue.correlation_id`) и в операции синхронизации.

```bash
# cloud / offline store (Docker): all records of one request, including background jobs it spawned
docker logs pharmacy-api 2>&1 | grep '"correlationId":"7f3a9c21-...'
```

```sql
SELECT id, queue, status, attempts, last_error, run_after
FROM job_queue WHERE correlation_id = $1;
```

## 2. Очереди-таблицы

```sql
-- Depth and age per queue/status
SELECT queue, status, count(*) AS jobs, min(created_at) AS oldest
FROM job_queue GROUP BY queue, status ORDER BY queue, status;

-- Dead-letter
SELECT id, tenant_id, queue, attempts, last_error, updated_at
FROM job_queue WHERE status = 'dead' ORDER BY updated_at DESC LIMIT 50;

-- Stuck in processing (worker died)
SELECT id, queue, locked_by, locked_at FROM job_queue
WHERE status = 'processing' AND locked_at < now() - interval '10 minutes';
```

Повторный запуск `dead`-задачи — действие оператора в админке с аудитом (`nestjs-messaging-basics.md`), не ручной `UPDATE` в проде.

## 3. Синхронизация офлайн-точек

```sql
-- Sync lag per store (cloud side): last accepted operation per offline store
SELECT store_id, max(received_at) AS last_received, count(*) FILTER (WHERE applied_at IS NULL) AS pending_apply
FROM sync_inbox GROUP BY store_id ORDER BY last_received NULLS FIRST;
```

На точке: глубина локального `sync_outbox`, состояние цепи `sync-upload` (OPEN = нет связи с облаком), срок лицензионного ключа. Названия таблиц — иллюстрация.

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

Публичные `/api/health/live|ready` — минимальные (`nestjs-enterprise-infrastructure.md`). Подробности — во внутреннем эндпоинте только для оператора платформы:

```typescript
// apps/api/src/common/health/diagnostics.controller.ts
@Controller({ path: 'internal/diagnostics', version: '1' })   // /api/v1/internal/diagnostics
@RequirePermission('platform', 'diagnostics')
export class DiagnosticsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobQueueStats,
    private readonly breakers: CircuitBreakerRegistry,
  ) {}

  @Get()
  async get() {
    const mem = process.memoryUsage();
    return {
      uptimeSec: Math.round(process.uptime()),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      dbLatencyMs: await timeMs(() => this.db.ping()),   // timeMs: small helper measuring a promise
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
