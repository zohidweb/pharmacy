# NestJS Enterprise Infrastructure — заголовки безопасности, Swagger, health checks

Rate limiting — отдельный файл `nestjs-rate-limiting.md`. CORS — `nestjs-security-scanning.md`.

## Заголовки безопасности (helmet, Express)

api отдаёт только JSON (и файлы выгрузки 1С), поэтому CSP — максимально строгая.

```typescript
// apps/api/src/main.ts (fragment)
import helmet from 'helmet';

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: false, // HSTS is sent by the reverse proxy where it terminates TLS (ADR-0012)
  }),
);
app.getHttpAdapter().getInstance().disable('x-powered-by');
```

- Если Swagger UI включён локально — ему нужна более мягкая CSP; включайте её только для
  `api/docs` и только вне production.
- HSTS ставит только proxy Caddy в профилях `acme`/`files` (ADR-0012); в helmet API он выключен, чтобы не
  дублировать заголовок и не слать его офлайн-точке по `http://localhost`.

## Swagger / OpenAPI (опционально)

- Включается флагом `ENABLE_SWAGGER`; в production публично не отдаётся.
- Декораторы `@ApiTags`/`@ApiOperation` — в контроллерах apps/api.
- DTO лежат в `libs/shared/dto` без `@nestjs/*`, поэтому `@ApiProperty` там не пишем. Если
  нужна полная схема DTO — подключите swagger CLI plugin в сборке apps/api (проверить
  совместимость с Nx-сборкой) или ограничьтесь документацией операций.
- Экспорт `openapi.json` «для API gateway» не делаем — API gateway пока не выбран (вводится через ADR);
  типы для фронтендов уже общие (`libs/shared/dto`).

## Health checks

Два эндпоинта: liveness (процесс жив) и readiness (PostgreSQL и, в облаке, Redis доступны).
Используются healthcheck'ом Docker на офлайн-точке и мониторингом облака (когда он будет
выбран через ADR). Без аутентификации, без детальной информации об окружении.

Сейчас в коде только liveness:

```typescript
// apps/api/src/app/health/health.controller.ts (real file)
import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/guards/decorators';

@Public()
@SkipThrottle()
@Controller('health') // default version 1 -> /api/v1/health (Dockerfile healthcheck, web connectivity ping)
export class HealthController {
  @Get() // liveness — the path is used by apps/api/Dockerfile and apps/web, do not move it
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

Readiness (`GET /api/v1/health/ready`) добавляется вместе с `@nestjs/terminus` (разрешён в
`nestjs-config-npm-ts.md`, в зависимостях пока нет). Redis — через тот же клиент `REDIS_CLIENT`
(`core/redis`), что и у сессий; на офлайн-точке клиента нет (`null`) и проверки Redis нет. Клиент
создан без офлайн-очереди (`disableOfflineQueue`): пока Redis переподключается, `ping()`
отклоняется сразу — readiness отвечает `down`, а не зависает.

```typescript
// apps/api/src/app/health/health.controller.ts — readiness, to be added (fragment)
import { Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { TenantDatabase } from '../../core/database';
import { REDIS_CLIENT, type RedisClient } from '../../core/redis/redis.tokens';

  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly db: TenantDatabase, // ping(): `select 1` without a tenant context — add with /health/ready
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient | null, // null on an offline store
  ) {}

  @Get('ready') // readiness: /api/v1/health/ready
  @HealthCheck()
  ready() {
    const redis = this.redis;
    return this.health.check([
      () => this.probe('database', () => this.db.ping()),
      ...(redis ? [() => this.probe('redis', () => redis.ping())] : []),
    ]);
  }

  private async probe(key: string, check: () => Promise<unknown>) {
    const indicator = this.indicators.check(key);
    try {
      await check();
      return indicator.up();
    } catch {
      return indicator.down({ message: 'unavailable' }); // no error text: it may leak hosts/credentials
    }
  }
```

`HealthIndicatorService` — API Terminus 11; старый `HealthIndicator`/`HealthCheckError`
объявлены устаревшими. Если в проекте другая мажорная версия — сверьтесь с документацией
(Context7).

Проверки внешних интеграций (фискализация, синхронизация) в readiness **не включаем**: их недоступность
не должна выводить api из работы — касса продолжает продавать, фискализация уходит в очередь.
