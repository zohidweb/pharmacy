> **Pharmacy:** адаптировано под стек Pharmacy — контекст запроса на `AsyncLocalStorage` (без библиотек) с correlationId, tenantId, employeeId, storeId/охватом точек; тенант — только из серверной сессии или лицензионного ключа точки; восстановление контекста в воркерах очереди и cron; Fastify-типы удалены. Ограничения: `CLAUDE.md`.

# NestJS Resilience — Request Context & Correlation

Circuit breaker, retry, timeout — `nestjs-resilience-circuit-breaker.md`. Тесты — `nestjs-testing-patterns.md`.

## Модель контекста

Контекст доступен из любой точки обработки запроса без передачи параметрами. Его читают: слой данных (`requireTenantId()` → `set_config('app.tenant_id', …)`), логгер (`nestjs-observability.md`), аудит, фильтр ошибок (`correlationId` в problem+json), исходящие вызовы интеграций.

| Поле | Кто заполняет | Источник |
|---|---|---|
| `correlationId` | `CorrelationIdMiddleware` | заголовок `X-Correlation-Id` (если валиден) или новый UUID |
| `tenantId`, `employeeId`, `storeScope`, `terminalId`, `actingOperatorId`, `permissions` | `SessionAuthGuard` | серверная сессия в Redis (`nestjs-security-auth.md`) |
| `tenantId`, `storeId` для эндпоинтов sync | `LicenseKeyGuard` | лицензионный ключ офлайн-точки |
| `storeId` для PIN-сессии кассы | `SessionAuthGuard` | точка привязанного терминала |

`tenantId`, `employeeId`, `storeId` **никогда не берутся из тела, query или заголовков клиента**. `employeeId` — «сотрудник» из глоссария (термин вместо общего `userId`); для оператора платформы в режиме «от имени» дополнительно `actingOperatorId`.

```typescript
// apps/api/src/common/context/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  employeeId?: string;
  /** Current store: bound POS terminal (PIN session) or offline store (license key). */
  storeId?: string;
  /** Stores the employee may act on. */
  storeScope?: 'all' | string[];
  terminalId?: string;
  actingOperatorId?: string;
  permissions?: ReadonlySet<string>;          // 'module:action'
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => requestContextStorage.getStore();
export const getCorrelationId = (): string | undefined => getRequestContext()?.correlationId;
export const getTenantId = (): string | undefined => getRequestContext()?.tenantId;
export const getEmployeeId = (): string | undefined => getRequestContext()?.employeeId;
export const getStoreId = (): string | undefined => getRequestContext()?.storeId;

export class TenantContextMissingError extends Error {
  constructor() {
    super('Tenant context is missing');     // programming error → 500, never an unscoped query
  }
}

export function requireTenantId(): string {
  const tenantId = getTenantId();
  if (!tenantId) throw new TenantContextMissingError();
  return tenantId;
}

/** Runs fn in a fresh context — for background work (queue workers, cron) and tests. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run({ ...context }, fn);
}
```

- Создаёт контекст `CorrelationIdMiddleware` (`nestjs-templates-core.md`): валидирует входящий ID (`/^[A-Za-z0-9-]{8,64}$/` — защита от инъекций в логи), возвращает его в заголовке ответа, запускает `requestContextStorage.run({ correlationId }, next)`.
- Guard-ы дополняют **тот же** объект (`Object.assign(store, {...})`) — Middleware выполняется раньше Guards, новый `run()` в guard-е не нужен.
- Нет тенанта — нет запроса к прикладным данным (fail closed). Кросс-тенантные операции оператора платформы — отдельный явный путь с аудитом (механика — ADR, `nestjs-config-data-access.md`).
- Готовые библиотеки контекста (nestjs-cls и т.п.) — только через ADR; `node:async_hooks` достаточно.

## Использование

```typescript
// apps/api/src/modules/audit/audit.service.ts (fragment)
async append(tx: Tx, entry: { action: string; entityId: string }): Promise<void> {
  const ctx = getRequestContext();
  await tx.query(
    `INSERT INTO audit_log (tenant_id, employee_id, store_id, acting_operator_id, correlation_id, action, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tx.tenantId, ctx?.employeeId ?? null, ctx?.storeId ?? null, ctx?.actingOperatorId ?? null,
     ctx?.correlationId ?? null, entry.action, entry.entityId],
  );
}
```

Исходящие вызовы интеграций передают correlation ID дальше (`X-Correlation-Id`), операции синхронизации офлайн-точки несут его вместе с `operationId`.

## Фоновая работа: восстановление контекста

HTTP-контекст не переживает постановку в очередь. Всё нужное сохраняется в строке задачи и восстанавливается воркером (`nestjs-messaging-basics.md`):

```typescript
// queue worker
runWithContext({ correlationId: job.correlationId, tenantId: job.tenantId }, () => handler.handle(job.payload, job));

// cron (@nestjs/schedule): no request — create a context, and only enqueue tenant work
@Cron('0 2 * * *', { timeZone: 'Asia/Dushanbe' })
nightly() {
  return runWithContext({ correlationId: randomUUID() }, () => this.enqueueNightlyJobs());
}
```

Если сторонний колбэк-API теряет async-цепочку — `AsyncResource.bind(fn)` из `node:async_hooks`.

## Best practices

- `CorrelationIdMiddleware` — глобально, на все маршруты (`forRoutes('*')`).
- В контексте — только идентификаторы и права; никаких ПДн, DTO, объектов ORM.
- Логи, аудит, problem+json, задачи очереди, исходящие вызовы — все несут `correlationId`.
- Не кешируйте значения контекста в полях singleton-провайдеров — только чтение через функции в момент вызова.
