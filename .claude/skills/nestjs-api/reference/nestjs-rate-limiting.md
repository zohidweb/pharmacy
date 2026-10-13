# Inbound Rate Limiting — NestJS (@nestjs/throttler)

Защита от перебора паролей/PIN и от «шумного соседа» (единая БД на всех тенантов, ADR-0002).
Edge-защита (WAF, балансировщик) — вне этого скила: зависит от места хостинга (открытый
вопрос stack.md).

## Хранилище лимитов

| Развёртывание | Хранилище |
|---|---|
| Облако (`STORE_MODE=cloud`), несколько stateless-инстансов api | Redis — `RedisThrottlerStorage` (общий счётчик для всех инстансов) |
| Офлайн-точка (`STORE_MODE=offline`, один процесс) | in-memory хранилище `@nestjs/throttler` |

```typescript
// apps/api/src/app/app.module.ts (fragment)
const DEFAULT_THROTTLE = { name: 'default', ttl: 60_000, limit: 300 }; // per tracker, per minute

ThrottlerModule.forRootAsync({
  inject: [REDIS_CLIENT],
  useFactory: (client: RedisClient | null) => ({
    throttlers: [DEFAULT_THROTTLE],
    // No Redis client on an offline store (a single process): the package's in-memory storage.
    ...(client ? { storage: new RedisThrottlerStorage(client) } : {}),
  }),
}),
```

`RedisThrottlerStorage` (`apps/api/src/common/throttling/redis-throttler.storage.ts`) — своя
реализация `ThrottlerStorage` из `@nestjs/throttler` 6 на единственном клиенте node-redis
(`REDIS_CLIENT` из `core/redis`, ADR-0008): один Lua-скрипт на запрос (фиксированное окно + ключ
блокировки), сроки возвращаются в секундах для `Retry-After`. В ключах нет ПДн: guard передаёт
SHA-256 маршрута и трекера. Другой адаптер хранилища или второй Redis-клиент — только через ADR.

## Трекер: сотрудник, а не только IP

В аптеке несколько касс часто выходят в интернет с одного IP — лимит только по IP накажет всю
точку. Поэтому трекер — сотрудник, оператор платформы — свой id, гость — IP.

```typescript
// apps/api/src/common/throttling/principal-throttler.guard.ts
@Injectable()
export class PrincipalThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const principal = getPrincipal();
    if (principal) return principal.employeeId;
    const operator = getOperator();
    if (operator) return `op:${operator.operatorId}`;
    return super.getTracker(req); // guest: req.ip
  }

  // Retry-After is already set by ThrottlerGuard; the limit details are not exposed.
  protected override async throwThrottlingException(): Promise<void> {
    throw new ProblemException(429, 'too_many_requests');
  }
}
```

- Принципала guard не строит: контекст запроса собирает `SessionMiddleware` (после
  `CorrelationIdMiddleware`, до guard'ов) и замораживает через `runWithContext`; guard только
  читает `getPrincipal()` / `getOperator()` (`nestjs-security-auth.md`, «Контекст запроса»).
- Guard глобальный (`APP_GUARD`), третий — после `AuthGuard` и `CsrfGuard`; порядок задан только в
  `apps/api/src/app/app.module.ts`, таблица guard'ов — `nestjs-security-auth.md`.
- На `@Public()`-маршрутах без сессии трекер — IP, поэтому вход дополнительно ограничен по
  идентификатору (ниже). За reverse proxy `req.ip` верен только при правильном `TRUST_PROXY`
  (CLAUDE.md, «Containers»).

## Жёсткие лимиты на аутентификацию

```typescript
// apps/api/src/common/throttling/auth-route-limit.ts
export const AUTH_ROUTE_LIMIT = { limit: 60, ttl: 60_000 }; // per IP and minute

// apps/api/src/app/auth/sessions.controller.ts (fragment)
@Public()
@Throttle({ default: AUTH_ROUTE_LIMIT })
@Post()                       // POST /api/v1/sessions — login + password
async login(@Body() body: EmployeeLoginDto /* , … */) { /* ... */ }
```

`AUTH_ROUTE_LIMIT` — одна граница для всех маршрутов входа, активации и PIN: `POST /sessions`,
`POST /sessions/current/confirmation`, `POST /activations`, `POST /terminal-sessions` (PIN на
привязанном терминале), `POST /operator/sessions`, `POST /operator/activations`. Новый такой
маршрут берёт ту же константу.

Throttler — только первый рубеж. Основная защита от перебора — порт `LoginLimiter`
(`apps/api/src/app/auth/login-limiter.ts`): атомарный счётчик неудач с блокировкой по
идентификатору (вход, активация, подтверждение и смена пароля, смена PIN) и по терминалу (PIN) —
`RedisLoginLimiter` в облаке (ключи — HMAC идентификатора, ПДн в Redis нет), `MemoryLoginLimiter`
на офлайн-точке. Пороги, коды ответов (`429 login_locked`, `423 terminal_locked`; блокировка PIN
сотрудника в БД — `423 pin_locked`) и аудит — `nestjs-security-auth.md`.

## Правила

- Синхронизация офлайн-точек лимитируется по `keyId` лицензионного ключа (ADR-0014 §6), а
  неудачные попытки — по IP;
  лимит должен пропускать штатную досылку накопленной очереди после перебоя связи
  (порционно, с `Retry-After` при 429).
- Ответ 429 — `ProblemException(429, 'too_many_requests')`: `application/problem+json` с
  `correlationId` и `Retry-After`.
- `@SkipThrottle()` — только для health checks.
