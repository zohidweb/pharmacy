# Inbound Rate Limiting — NestJS (@nestjs/throttler)

Защита от перебора паролей/PIN и от «шумного соседа» (единая БД на всех тенантов, ADR-0002).
Edge-защита (WAF, балансировщик) — вне этого скила: зависит от места хостинга (открытый
вопрос stack.md).

## Хранилище лимитов

| Развёртывание | Хранилище |
|---|---|
| Облако, несколько stateless-инстансов api | Redis (общий счётчик для всех инстансов) |
| Офлайн-точка (один инстанс) / локально | in-memory (по умолчанию) допустимо |

```typescript
// apps/api/src/app/app.module.ts (fragment)
ThrottlerModule.forRootAsync({
  inject: [RedisService, applicationConfig.KEY],
  useFactory: (redis: RedisService, app: ConfigType<typeof applicationConfig>) => ({
    throttlers: [
      { name: 'default', ttl: 60_000, limit: 300 }, // per tracker, per minute
    ],
    // Redis storage adapter for throttler: a community package (e.g. @nest-lab/throttler-storage-redis).
    // Check maintenance status and license before adding it; alternatively implement ThrottlerStorage on RedisService.
    storage: app.deploymentMode === 'cloud' ? redis.throttlerStorage() : undefined,
  }),
}),
```

## Трекер: сотрудник, а не только IP

В аптеке несколько касс часто выходят в интернет с одного IP — лимит только по IP накажет всю
точку. Для аутентифицированных запросов считаем по сессии/сотруднику.

```typescript
// apps/api/src/common/throttling/tenant-aware-throttler.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { getRequestContext } from '../context/request-context';

@Injectable()
export class TenantAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const ctx = getRequestContext();
    return ctx?.employeeId ? `t:${ctx.tenantId}:e:${ctx.employeeId}` : `ip:${req.ip}`;
  }
}
```

Guard регистрируется глобально вместо `ThrottlerGuard` и **после** `AuthGuard`
(порядок: session → throttle → permissions), иначе контекст сотрудника ещё пуст.
`AuthGuard` для `@Public()`-маршрутов пропускает запрос дальше, и трекером становится
IP; поэтому логин дополнительно ограничивается по учётной записи (ниже).

## Жёсткие лимиты на аутентификацию

```typescript
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Post('sessions')            // POST /api/v1/sessions — login + password
login(@Body() dto: LoginDto) { /* ... */ }

@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Post('terminal-sessions/current/switch-employee')   // PIN switch on a bound terminal
switchEmployee(@Body() dto: PinSwitchDto) { /* ... */ }
```

Throttler — только первый рубеж. Основная защита — счётчик неудачных попыток **по учётной
записи** (логин тенанта / сотрудник + терминал) в Redis с блокировкой на
`PIN_LOCKOUT_SECONDS` после `PIN_MAX_ATTEMPTS` (`nestjs-security-auth.md`). Блокировка и
разблокировка пишутся в аудит.

## Правила

- Синхронизация офлайн-точек лимитируется по `keyId` лицензионного ключа (ADR-0014 §6), а
  неудачные попытки — по IP;
  лимит должен пропускать штатную досылку накопленной очереди после перебоя связи
  (порционно, с `Retry-After` при 429).
- Ответ 429 — тоже `application/problem+json` с `correlationId`.
- `@SkipThrottle()` — только для health checks.
