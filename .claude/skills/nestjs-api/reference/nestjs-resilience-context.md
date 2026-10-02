> **Pharmacy:** адаптировано под стек Pharmacy — контекст запроса на `AsyncLocalStorage` (без библиотек) с correlationId, tenantId, employeeId, storeId/охватом точек; тенант — только из серверной сессии или лицензионного ключа точки; восстановление контекста в воркерах очереди и cron; Fastify-типы удалены. Ограничения: `CLAUDE.md`.

# NestJS Resilience — Request Context & Correlation

Circuit breaker, retry, timeout — `nestjs-resilience-circuit-breaker.md`. Тесты — `nestjs-testing-patterns.md`.

## Модель контекста

Контекст доступен из любой точки обработки запроса без передачи параметрами. Его читают: слой данных (`requireTenantId()` → `set_config('app.tenant_id', …)`), логгер (`nestjs-observability.md`), аудит, фильтр ошибок (`correlationId` в problem+json), исходящие вызовы интеграций.

| Поле | Кто заполняет | Источник |
|---|---|---|
| `correlationId` | `CorrelationIdMiddleware` | заголовок `X-Correlation-Id` (если валиден) или новый UUID |
| `tenantId`, `employeeId`, `storeScope`, `terminalId`, `actingOperatorId`, `impersonationId`, `permissions` | `SessionAuthGuard` | серверная cookie-сессия (облако — Redis, офлайн — PostgreSQL; `nestjs-security-auth.md`) |
| `tenantId`, `storeId` для эндпоинтов sync | `LicenseKeyGuard` | лицензионный ключ точки, найденный резолвером `resolve_license_key` (SECURITY DEFINER, ADR-0013) |
| `tenantId`, `jobId` для фоновой задачи | `TenantJobRunner` | строка очереди / список активных тенантов (ADR-0013 §4) |
| `storeId` для PIN-сессии кассы | `SessionAuthGuard` | точка привязанного терминала |

`tenantId`, `employeeId`, `storeId` **никогда не берутся из тела, query или заголовков клиента**. `employeeId` — «сотрудник» из глоссария (термин вместо общего `userId`); для оператора платформы в режиме «от имени» дополнительно `actingOperatorId`.

Реальный файл — `apps/api/src/common/context/request-context.ts`; сейчас в нём `correlationId` и
`tenantId`, остальные поля добавляет план аутентификации:

```typescript
// apps/api/src/common/context/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  // added with the auth module:
  employeeId?: string;
  storeId?: string;                 // bound terminal's store (PIN session) or offline store (license key)
  storeScope?: 'all' | string[];
  terminalId?: string;
  actingOperatorId?: string;
  impersonationId?: string;
  permissions?: ReadonlySet<string>; // catalog strings 'module:action'
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => requestContextStorage.getStore();

export class TenantContextMissingError extends Error {
  constructor() {
    super('Tenant context is missing'); // programming error -> 500, never an unscoped query
    this.name = 'TenantContextMissingError';
  }
}

export function requireTenantId(): string {
  const tenantId = getRequestContext()?.tenantId;
  if (!tenantId) throw new TenantContextMissingError();
  return tenantId;
}

/** Runs fn in a fresh copy of the context — for background work (queue workers, cron) and tests. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run({ ...context }, fn);
}
```

- Создаёт контекст `CorrelationIdMiddleware` (`nestjs-templates-core.md`): валидирует входящий ID (`/^[A-Za-z0-9-]{8,64}$/` — защита от инъекций в логи), возвращает его в заголовке ответа, запускает `requestContextStorage.run({ correlationId }, next)`.
- Guard дополняет **тот же** объект один раз (Middleware выполняется раньше Guards) и затем **замораживает** его: после guard контекст неизменяем, иначе любой код мог бы подменить `tenantId` посреди запроса. Сейчас `getRequestContext()` возвращает изменяемый объект — заморозку ввести **до** реализации guards (follow-up плана B).
- Нет тенанта — нет запроса к прикладным данным (fail closed). Кросс-тенантный путь — `PlatformDatabase` в `app/platform/**` (ADR-0013, `nestjs-config-data-access.md`).
- Готовые библиотеки контекста (nestjs-cls и т.п.) — только через ADR; `node:async_hooks` достаточно.

## Использование

```typescript
// apps/api/src/app/audit/audit.service.ts (fragment) — audit_log arrives with the audit migration
async append(trx: TenantTransaction, entry: { action: string; entityType: string; entityId: string }): Promise<void> {
  const ctx = getRequestContext();
  await trx
    .insertInto('auditLog')
    .values({
      id: newId(),
      tenantId: requireTenantId(),
      employeeId: ctx?.employeeId ?? null,
      storeId: ctx?.storeId ?? null,
      actingOperatorId: ctx?.actingOperatorId ?? null,
      impersonationId: ctx?.impersonationId ?? null,
      correlationId: ctx?.correlationId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
    })
    .execute();
}
```

Исходящие вызовы интеграций передают correlation ID дальше (`X-Correlation-Id`), операции синхронизации офлайн-точки несут его вместе с `operationId`.

## Фоновая работа: восстановление контекста

HTTP-контекст не переживает постановку в очередь. Всё нужное сохраняется в строке задачи и восстанавливается воркером (`nestjs-messaging-basics.md`):

```typescript
// tenant job (ADR-0013 §4): "per tenant in a loop" — TenantJobRunner opens the context and the transaction
await this.jobs.forEachActiveTenant(async (tenantId) =>
  runWithContext({ correlationId: newId(), tenantId }, () =>
    this.db.withTenant(tenantId, (trx) => this.handlers.processPending(trx, tenantId)),
  ),
);

// cron (@nestjs/schedule): no request — create a context, and only enqueue tenant work
@Cron('0 2 * * *', { timeZone: 'Asia/Dushanbe' })
nightly() {
  return runWithContext({ correlationId: newId() }, () => this.enqueueNightlyJobs());
}
```

- `TenantJobRunner.forEachActiveTenant()` / `runAsTenant(tenantId)` — единственный способ коду
  платформы открыть tenant-контекст; живёт в `app/platform/jobs/**` и **бросает исключение, если
  вызван в контексте HTTP-запроса**: оператор не может «перепрыгнуть» в тенанта мимо входа «от
  имени» (ADR-0013 §7).
- Список активных тенантов воркер получает через `PlatformDatabase` (облако) или из локальной
  активации (офлайн-точка, один тенант).

Если сторонний колбэк-API теряет async-цепочку — `AsyncResource.bind(fn)` из `node:async_hooks`.

## Best practices

- `CorrelationIdMiddleware` — глобально, на все маршруты (`forRoutes('*')`).
- В контексте — только идентификаторы и права; никаких ПДн, DTO, объектов ORM.
- Логи, аудит, problem+json, задачи очереди, исходящие вызовы — все несут `correlationId`.
- Не кешируйте значения контекста в полях singleton-провайдеров — только чтение через функции в момент вызова.
