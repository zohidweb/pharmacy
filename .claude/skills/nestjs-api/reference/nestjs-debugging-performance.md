> **Pharmacy:** адаптировано под стек Pharmacy — ориентир «операция кассы ≤ 1 сек»; Prisma-middleware заменён на средства PostgreSQL (ORM — после ADR); публичный memory-эндпоинт и сброс circuit breaker через API удалены. Ограничения: `CLAUDE.md`.

# NestJS Debugging — Performance & Memory

## 0. Бюджет производительности

ТЗ: **операция кассы ≤ 1 сек** (скан → цена/остаток → проведение чека) при до 50 одновременных кассирах с запасом ×5 (≈ 250).

| Участок | Ориентир (рекомендация, уточняется замерами) |
|---|---|
| API кассы: поиск по штрихкоду, цена | p95 ≤ 150 мс (кэш каталога/цен в Redis) |
| API кассы: проведение чека (транзакция + движения + outbox) | p95 ≤ 300 мс |
| Остальное (сеть, UI, печать) | остаток до 1 сек |

Всё внешнее (фискализация, НБТ, синхронизация) — вне пути кассы, через очередь-таблицу (`nestjs-messaging-basics.md`). Сначала измеряйте, потом оптимизируйте.

## 1. Утечки памяти

Типичные источники в NestJS:

```typescript
// BAD: a new DB client/pool per call — connections and memory leak
async findProducts() {
  const pool = createPool(process.env.DATABASE_URL);   // never closed
  return pool.query('...');
}
// GOOD: one pool per process, provided by the data-access module (ORM per ADR), closed on shutdown.

// BAD: listener added repeatedly
onModuleInit() {
  setInterval(() => this.emitter.on('price.changed', this.onPrice), 1000);
}
// GOOD: add once, remove in onModuleDestroy
onModuleInit() { this.emitter.on('price.changed', this.onPrice); }
onModuleDestroy() { this.emitter.off('price.changed', this.onPrice); }

// BAD: unbounded in-process Map cache keyed by tenant/product
private readonly cache = new Map<string, Price>();    // grows forever
// GOOD: Redis with TTL (approved for catalog/price cache), or a bounded LRU with TTL.
```

```bash
node --inspect dist/apps/api/main.js          # chrome://inspect → Memory → heap snapshots
node --max-old-space-size=512 dist/apps/api/main.js   # expose leaks faster (offline store PCs are small)
```

Сравнивайте два heap snapshot-а в Chrome DevTools (до/после серии запросов) — растущие `Map`, `Array`, `EventEmitter`, замыкания.

Эндпоинт с `process.memoryUsage()` без авторизации не публикуйте — такие данные только во внутренней диагностике админки под правом оператора.

## 2. Измерение времени запросов

Замер длительности каждого запроса и предупреждение о медленных — в `RequestLoggingInterceptor` (`nestjs-observability.md`, порог `SLOW_REQUEST_MS`). Для точечного профилирования участка:

```typescript
// apps/api/src/common/debug/timed.ts
export async function timed<T>(logger: Logger, label: string, fn: () => Promise<T>, warnMs = 100): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms > warnMs) logger.warn({ msg: 'slow step', step: label, durationMs: Math.round(ms) });
    else logger.debug({ msg: 'step', step: label, durationMs: Math.round(ms) });
  }
}

// usage inside ReceiptsService.completeReceipt
const picks = await timed(this.logger, 'fefo-pick', () => this.batches.pickFefo(tx, storeId, productId, qty));
```

## 3. Производительность БД

Логирование SQL со стороны приложения — средствами выбранного ORM после ADR. Средствами PostgreSQL — `log_min_duration_statement`, `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)` (`nestjs-debugging-logging.md`).

Горячие пути кассы и индексы-кандидаты (схема — миграциями после ADR):

| Запрос | Индекс-кандидат |
|---|---|
| Товар по штрихкоду | `(tenant_id, barcode)` |
| FEFO: партии товара на точке по сроку | `(tenant_id, store_id, product_id, expiry_date)` |
| Остаток партии = сумма движений | `(tenant_id, store_id, batch_id)` в `stock_movements` |
| Идемпотентность чека | `UNIQUE (tenant_id, idempotency_key)` в `receipts` |

- `tenant_id` — первым столбцом составных индексов прикладных таблиц.
- Остатки не хранятся. Если суммирование движений станет узким местом — любые снапшоты/агрегаты остатков только через ADR (меняют ключевой инвариант), не молча.
- N+1 при формировании чека/документа — загружать партии пачкой (`WHERE batch_id = ANY($1)`).
- Долгие транзакции блокируют строки и держат соединения пула — никаких внешних HTTP-вызовов внутри транзакции.

```sql
-- Long-running transactions and lock waits right now
SELECT pid, now() - xact_start AS xact_age, state, wait_event_type, left(query, 100)
FROM pg_stat_activity
WHERE datname = current_database() AND xact_start IS NOT NULL
ORDER BY xact_age DESC LIMIT 10;
```

## 4. CPU-профилирование

```bash
node --cpu-prof dist/apps/api/main.js           # writes .cpuprofile on exit → open in Chrome DevTools
node --inspect-brk dist/apps/api/main.js        # chrome://inspect → Profiler
node --prof dist/apps/api/main.js && node --prof-process isolate-*.log > profile.txt
```

Нагрузочный прогон сценария кассы (250 параллельных «кассиров») — инструмент нагрузки **согласовать** (не описан в радаре), см. `nestjs-testing-ci-troubleshooting.md`.

## 5. Состояние circuit breaker-ов

Реестр и реализация — `nestjs-resilience-circuit-breaker.md`. Состояния видны:
- во внутреннем диагностическом эндпоинте админки (только чтение, под правом оператора платформы):

```typescript
// apps/api/src/common/resilience/resilience-diagnostics.controller.ts
@Controller({ path: 'internal/resilience', version: '1' })   // /api/v1/internal/resilience
@RequirePermission('platform', 'diagnostics')          // permission decorator per nestjs-security-auth.md
export class ResilienceDiagnosticsController {
  constructor(private readonly registry: CircuitBreakerRegistry) {}

  @Get('circuits')
  circuits() {
    return this.registry.snapshots();                  // name, state, consecutiveFailures, openedAt
  }
}
```

Ручной сброс цепи через API не делаем: цепь сама перейдёт в HALF_OPEN по таймауту. Если сброс понадобится — отдельное действие оператора с записью в аудит.
