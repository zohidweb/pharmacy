> **Pharmacy:** адаптировано под стек Pharmacy — библиотека логирования и мониторинг пока не выбраны (вводятся через ADR); до ADR — только встроенный Nest Logger с собственным JSON-`LoggerService` (без внешних библиотек), correlation ID в каждой записи, маскирование ПДн, ссылки на health-чеки. OpenTelemetry/Prometheus/облачный логгинг удалены. Ограничения: `CLAUDE.md`.

# NestJS Observability & Logging

OpenTelemetry, Prometheus/Grafana, Sentry/APM, облачный логгинг, pino/winston — **только после соответствующего ADR** (пока не выбраны).

## Правила

- Логи — одна JSON-строка на запись в stdout; сбор — средствами среды (docker logs / хост); на офлайн-точке — ротация драйвера логов Docker (`max-size`, `max-file` в compose).
- В каждой записи: `ts`, `level`, `context`, `msg`, `correlationId`, `tenantId`, `employeeId`, `storeId` (из контекста запроса — `nestjs-resilience-context.md`). `tenantId`/`employeeId` — не ПДн, их логировать нужно.
- **ПДн не логируются**: ФИО и телефоны сотрудников, реквизиты поставщиков, поля рецептов ПКУ, пароли, PIN, идентификаторы сессий, лицензионные ключи. Передавайте данные объектом `meta`, а не интерполяцией в строку, — тогда их видит маскировщик.
- Тела запросов/ответов не логируются.
- Логи ≠ аудит: действия пользователей и журнал ПКУ пишутся в append-only таблицы модуля audit, а не в лог.

## JSON LoggerService (без внешних библиотек)

```typescript
// apps/api/src/common/logging/json-logger.ts
import { LoggerService, LogLevel } from '@nestjs/common';
import { getRequestContext } from '../context/request-context';
import { mask } from './mask'; // PII/secret masking — nestjs-security-validation-logging.md

const ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

export class JsonLogger implements LoggerService {
  private minIndex: number;

  constructor(level: LogLevel = 'log') {
    this.minIndex = ORDER.indexOf(level);
  }

  setLogLevels(levels: LogLevel[]): void {
    this.minIndex = Math.min(...levels.map((l) => ORDER.indexOf(l)));
  }

  log(message: unknown, ...params: unknown[]) { this.write('log', message, params); }
  warn(message: unknown, ...params: unknown[]) { this.write('warn', message, params); }
  debug(message: unknown, ...params: unknown[]) { this.write('debug', message, params); }
  verbose(message: unknown, ...params: unknown[]) { this.write('verbose', message, params); }
  fatal(message: unknown, ...params: unknown[]) { this.write('fatal', message, params); }
  error(message: unknown, ...params: unknown[]) { this.write('error', message, params); }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    if (ORDER.indexOf(level) < this.minIndex) return;

    // Nest convention: last string param is the context; for error() the first string param may be a stack.
    const rest = [...params];
    const context = typeof rest.at(-1) === 'string' ? (rest.pop() as string) : undefined;
    const stack = level === 'error' && typeof rest[0] === 'string' ? (rest.shift() as string) : undefined;
    const err = message instanceof Error ? message : undefined;

    const ctx = getRequestContext();
    const entry = {
      ts: new Date().toISOString(),
      level,
      context,
      msg: err ? err.message : typeof message === 'string' ? message : undefined,
      correlationId: ctx?.correlationId,
      tenantId: ctx?.tenantId,
      employeeId: ctx?.employeeId,
      storeId: ctx?.storeId,
      ...(typeof message === 'object' && !err ? (mask(message) as object) : {}), // masked again as a safety net
      stack: stack ?? err?.stack,
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}
```

Маскирование — функция `mask()` из `nestjs-security-validation-logging.md` (ключи секретов → `***`, ключи ПДн → частичная маска). Логгер применяет её к объекту записи повторно как страховку; основное правило — маскировать до передачи в логгер. Внимание: `inn` в коде проекта — это МНН (действующее вещество), не ПДн.

В NestJS 11 у встроенного `ConsoleLogger` есть JSON-режим (`new ConsoleLogger({ json: true })`); собственный `LoggerService` нужен ради полей контекста и маскирования.

### Регистрация

```typescript
// apps/api/src/main.ts (fragment)
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(new JsonLogger((process.env.LOG_LEVEL as LogLevel) ?? 'log'));
app.enableShutdownHooks();
```

В сервисах — обычный `private readonly logger = new Logger(ReceiptsService.name)`: он делегирует в `JsonLogger`.

```typescript
this.logger.log({ msg: 'receipt paid', receiptId: receipt.id, totalDirams: receipt.totalDirams });
this.logger.error({ msg: 'fiscal send failed', receiptId }, err.stack);
```

## Логирование запросов

```typescript
// apps/api/src/common/logging/request-logging.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly slowMs = Number(process.env.SLOW_REQUEST_MS ?? 1000); // POS target: ≤ 1 s per operation

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; route?: { path?: string }; url: string }>();
    const route = req.route?.path ?? req.url.split('?')[0];     // route template, no query string
    const started = process.hrtime.bigint();

    const done = (status: number) => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const entry = { msg: 'request', method: req.method, route, status, durationMs: Math.round(durationMs) };
      if (durationMs > this.slowMs) this.logger.warn({ ...entry, slow: true });
      else this.logger.log(entry);
    };

    return next.handle().pipe(
      tap({
        next: () => done(context.switchToHttp().getResponse<{ statusCode: number }>().statusCode),
        error: (err: { status?: number }) => done(err.status ?? 500),
      }),
    );
  }
}
```

Ошибки 5xx со стеком логирует глобальный фильтр исключений (RFC 7807 — `nestjs-enterprise-patterns.md`); клиенту стек не отдаётся.

## Health-чеки

Liveness/readiness (`/api/health/live`, `/api/health/ready`: PostgreSQL + Redis, без деталей окружения) — `nestjs-enterprise-infrastructure.md`. Внешние интеграции (фискализация, синхронизация) в readiness не входят: их недоступность деградирует функции, но не выводит api из работы.

Подробности (задержка БД, глубина очередей, `dead`-задачи, состояния circuit breaker-ов, лаг синхронизации точек) — только во внутреннем диагностическом эндпоинте под правом оператора платформы (`nestjs-debugging-production.md`).

## Конфигурация

```bash
# .env.example
LOG_LEVEL=log            # verbose | debug | log | warn | error
SLOW_REQUEST_MS=1000
```

## Troubleshooting

| Проблема | Симптом | Решение |
|---|---|---|
| Нет correlationId в логах | поле пустое | `CorrelationIdMiddleware` не применён глобально, или запись сделана вне контекста (cron, воркер) — оборачивать в `runWithContext` |
| Нет tenantId в логах запроса | поле пустое до авторизации | Нормально для логов до guard-а; после — `SessionAuthGuard` дополняет контекст (`nestjs-resilience-context.md`) |
| ПДн в логах | ФИО/телефон в `msg` | Не интерполировать данные в строку — передавать объектом через `mask()`; дополнить `PII_KEYS` |
| Логи не JSON | текст Nest по умолчанию | `bufferLogs: true` + `app.useLogger(new JsonLogger())` до `listen` |
| Шум | много `debug` | `LOG_LEVEL=log` в проде |
