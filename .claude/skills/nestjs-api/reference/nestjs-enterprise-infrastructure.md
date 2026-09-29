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
    hsts: { maxAge: 31_536_000, includeSubDomains: true }, // HTTPS on every connection (CLAUDE.md)
  }),
);
app.getHttpAdapter().getInstance().disable('x-powered-by');
```

- Если Swagger UI включён локально — ему нужна более мягкая CSP; включайте её только для
  `api/docs` и только вне production.
- `hsts` имеет смысл только за HTTPS; на офлайн-точке с `127.0.0.1` он игнорируется браузером.

## Swagger / OpenAPI (опционально)

- Включается флагом `ENABLE_SWAGGER`; в production публично не отдаётся.
- Декораторы `@ApiTags`/`@ApiOperation` — в контроллерах apps/api.
- DTO лежат в `libs/shared/dto` без `@nestjs/*`, поэтому `@ApiProperty` там не пишем. Если
  нужна полная схема DTO — подключите swagger CLI plugin в сборке apps/api (проверить
  совместимость с Nx-сборкой) или ограничьтесь документацией операций.
- Экспорт `openapi.json` «для API gateway» не делаем — API gateway пока не выбран (вводится через ADR);
  типы для фронтендов уже общие (`libs/shared/dto`).

## Health checks (@nestjs/terminus)

Два эндпоинта: liveness (процесс жив) и readiness (PostgreSQL и Redis доступны).
Используются healthcheck'ом Docker на офлайн-точке и мониторингом облака (когда он будет
выбран через ADR). Без аутентификации, без детальной информации об окружении.

```typescript
// apps/api/src/core/health/health.controller.ts
import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../auth/decorators/public.decorator';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';

@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL }) // /api/health/...
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.probe('database', () => this.db.ping()),
      () => this.probe('redis', () => this.redis.ping()),
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
}
```

`HealthIndicatorService` — API Terminus 11; старый `HealthIndicator`/`HealthCheckError`
объявлены устаревшими. Если в проекте другая мажорная версия — сверьтесь с документацией
(Context7).

Проверки внешних интеграций (НБТ, фискализация) в readiness **не включаем**: их недоступность
не должна выводить api из работы — касса продолжает продавать, фискализация уходит в очередь.
