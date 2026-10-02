> **Pharmacy:** адаптировано под стек Pharmacy — Fastify-хуки и Prisma query logging удалены; жизненный цикл запроса — адаптер-независимо (стандартный NestJS/Express); логирование SQL — опция `log` у Kysely (ADR-0006) или `log_min_duration_statement` в PostgreSQL. Ограничения: `CLAUDE.md`. <!-- docs-check: ok -->

# NestJS Debugging — Logging & Request Lifecycle

## 1. Уровни логов по окружению

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';
import { JsonLogger } from './common/logging/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new JsonLogger((process.env.LOG_LEVEL as LogLevel) ?? 'log'));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
```

| Окружение | `LOG_LEVEL` |
|---|---|
| локально | `debug` |
| тесты | `warn` |
| облако / офлайн-точка | `log` |

`JsonLogger` и правила маскирования — `nestjs-observability.md`.

Запуск с отладчиком: executor `@nx/js:node` у `npx nx serve api` поддерживает опцию `inspect` — подключайтесь через `chrome://inspect` или VS Code «Attach to Node Process».

## 2. Логгер на модуль

```typescript
// apps/api/src/app/inventory/batches.service.ts
@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  async pickFefo(trx: TenantTransaction, storeId: string, productId: string, qtyPieces: number): Promise<BatchPick[]> {
    this.logger.debug({ msg: 'FEFO pick', storeId, productId, qtyPieces });  // ids only, no PII
    const picks = await this.batches.pickByExpiry(trx, storeId, productId, qtyPieces);
    if (sumQuantity(picks) < qtyPieces) {
      this.logger.warn({ msg: 'insufficient stock', storeId, productId, requested: qtyPieces });
      throw new InsufficientStockException(productId);
    }
    return picks;
  }
}
```

- Ошибку логируйте один раз — там, где она обрабатывается (обычно глобальный фильтр), а не на каждом уровне.
- Не глотайте исключения: `catch` → лог → `throw` либо осмысленная обработка.

## 3. Логирование SQL

Логирование запросов в приложении — опция `log` при создании `Kysely` в `core/database` (только уровень `error` и длительность; параметры не логируются целиком: в них `tenant_id` и ПДн — маскирование, ADR-0006 «Отрицательные»). Пока это не сделано, и для глубокой отладки — средствами PostgreSQL:

```yaml
# docker/compose.dev.yml (fragment) — local environment only
services:
  postgres:
    command:
      - postgres
      - -c
      - log_min_duration_statement=200     # log statements slower than 200 ms
      - -c
      - log_lock_waits=on
      - -c
      - shared_preload_libraries=pg_stat_statements
```

```sql
-- Top queries by total time (extension pg_stat_statements, part of PostgreSQL contrib)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT calls, round(mean_exec_time::numeric, 1) AS mean_ms, left(query, 120) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;

-- Plan of a concrete query
EXPLAIN (ANALYZE, BUFFERS) SELECT ... ;
```

- Параметры запросов в логах могут содержать ПДн — в облаке/на точках не включайте `log_statement = 'all'`.
- Правила индексов, RLS, блокировок — скил `postgres-best-practices`.

## 4. Жизненный цикл запроса (адаптер-независимо)

Порядок в NestJS: **Middleware → Guards → Interceptors (до) → Pipes → Handler → Interceptors (после) → Exception filters**.

| Симптом | Где искать |
|---|---|
| нет correlationId | Middleware (`CorrelationIdMiddleware`) |
| 401/403 | Guards (сессия, права «модуль × действие × охват точек») |
| 400 с `problem+json` | Pipes (`ValidationPipe`, DTO class-validator) |
| неверный формат ошибки | Exception filter |

```typescript
// apps/api/src/common/debug/lifecycle-debug.interceptor.ts — local debugging only
@Injectable()
export class LifecycleDebugInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Lifecycle');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    this.logger.debug({ msg: 'handler start', handler });   // guards already passed here
    return next.handle().pipe(
      tap({
        next: () => this.logger.debug({ msg: 'handler done', handler }),
        error: (e: Error) => this.logger.debug({ msg: 'handler error', handler, error: e.name }),
      }),
    );
  }
}
```

### Типичные проблемы

- **404 на существующий маршрут.** При старте Nest пишет `Mapped {/api/v1/..., GET} route` — проверьте, что маршрут есть в логе; модуль импортирован в `AppModule`; глобальный префикс `api` и версия не задублированы в `@Controller()`.
- **`req.body` пустой.** Заголовок `Content-Type: application/json`; для крупных тел (выгрузки) — лимит `app.useBodyParser('json', { limit: '5mb' })` (NestExpressApplication).
- **Некорректный JSON** даёт 400 от body-parser — фильтр ошибок должен вернуть его как `application/problem+json`, без эха тела запроса в лог.
