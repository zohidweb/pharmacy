# NestJS Core Templates — main.ts, AppModule, глобальные модули ядра

Шаблоны точки входа и корневого модуля `apps/api` (Express-адаптер). Основа — реальные
`apps/api/src/main.ts` и `apps/api/src/app/app.module.ts` (аутентификация ADR-0008, Redis и лимиты
уже в коде). Шаблон сокращён — перед правкой сверяйтесь с файлами.

## main.ts (apps/api/src/main.ts)

```typescript
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  // No CORS: web/admin and the API share one origin (reverse proxy in test/prod, rewrite in dev).
  // ADR-0008: "CORS выключен" — the session cookie is accepted only from its own origin.

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }); // -> /api/v1/...
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`API is running on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
```

Заметки:
- Ошибки старта (конфиг, БД) должны ронять процесс — не глушить `catch`-ом.
- CORS не включается (ADR-0008): браузер ходит в API с того же origin. Запросы с чужого origin
  отсекает CSRF-проверка (`Origin`, Fetch Metadata) — `nestjs-security-auth.md`.
- `trust proxy` задаётся `TRUST_PROXY` (`main.ts`): в test/prod за Caddy (ADR-0012) — `1`; без прокси — `0`,
  иначе `req.ip` подделывается заголовком. Лимиты тела API и proxy согласованы: `/api` — 100 KB в API и 1 MiB на
  proxy, синхронизация — 2 MiB после распаковки и 4 MiB, загрузки `*-imports` — 10 MiB
  (Caddy считает `MB` по 10⁶ байт — в Caddyfile только `MiB`).
- Лимит тела запроса Express по умолчанию 100 KB; для пакетов синхронизации (≤ 2 МБ после
  распаковки, ADR-0014) задать явно — осознанно, не «на всякий случай».

## AppModule (apps/api/src/app/app.module.ts)

```typescript
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../core/database';
import { RedisModule } from '../core/redis/redis.module';
import { CorrelationIdMiddleware } from '../common/middleware/correlation-id.middleware';
import { SessionMiddleware } from '../common/middleware/session.middleware';
import { ProblemDetailsFilter } from '../common/filters/problem-details.filter';
import { PrincipalThrottlerGuard } from '../common/throttling/principal-throttler.guard';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { FreshAuthGuard } from '../common/guards/fresh-auth.guard';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { OperatorPermissionsGuard } from './platform/auth/operator-permissions.guard';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { PosModule } from './pos/pos.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { PricingModule } from './pricing/pricing.module';
import { ReturnsModule } from './returns/returns.module';
import { BillingModule } from './billing/billing.module';
import { SyncModule } from './sync/sync.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { Export1cModule } from './export-1c/export-1c.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    DatabaseModule,
    RedisModule,
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] }),
    AuthModule,
    CatalogModule,
    InventoryModule,
    PosModule,
    PurchasingModule,
    PricingModule,
    ReturnsModule,
    BillingModule,
    SyncModule,
    FiscalModule,
    Export1cModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global guards run in registration order: the session principal (built by SessionMiddleware),
    // CSRF, the throttler (by principal), the permission, the operator contour, the step-up last.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PrincipalThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: OperatorPermissionsGuard },
    { provide: APP_GUARD, useClass: FreshAuthGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The correlation id first, then the frozen session context for every route.
    consumer
      .apply(CorrelationIdMiddleware, SessionMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
```

- Раскладка: доменные модули — `apps/api/src/app/<module>/`, аутентификация и права —
  `apps/api/src/app/auth/` (`nestjs-security-auth.md`), сквозное — `apps/api/src/common/`, ядро
  доступа к данным — `apps/api/src/core/database` (импорт только через его `index`).
- `ValidationPipe` остаётся в `main.ts` (как сейчас в коде); `validationError: { target: false,
  value: false }` добавить при первом DTO с персональными данными — ввод не эхом в ошибке.
- `AuthGuard` глобальный: маршрут без сессии возможен только с явным `@Public()`
  (логин, health). Детали — `nestjs-security-auth.md`; лимиты — `nestjs-rate-limiting.md`.
- `enableImplicitConversion` не включаем: неявное приведение строк к числам в query маскирует
  ошибки; числа в query-DTO — через `@Type(() => Number)` явно.
- Обёртку ответа (`TransformInterceptor` с `{ data: … }`) не используем: ответ — сам DTO,
  список — `{ items, total, limit, offset }`.

## CorrelationIdMiddleware (apps/api/src/common/middleware/correlation-id.middleware.ts)

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from '../context/request-context';

const HEADER = 'x-correlation-id';
const VALID = /^[A-Za-z0-9-]{8,64}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER);
    const correlationId = incoming && VALID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    // tenant/employee are added by SessionMiddleware (it replaces this context with the frozen one)
    requestContextStorage.run({ correlationId }, () => next());
  }
}
```

Полная модель контекста (AsyncLocalStorage, пробрасывание в воркеры) —
`nestjs-resilience-context.md`.

## Глобальные модули ядра

`DatabaseModule` (`apps/api/src/core/database/database.module.ts`, `@Global`, экспортирует
`TenantDatabase`) и `RedisModule` (`apps/api/src/core/redis/redis.module.ts`, `@Global`) подключены в
`AppModule`. Redis — один клиент node-redis 6 под токеном `REDIS_CLIENT` (`createRedisClient` в
`redis.tokens.ts`: без офлайн-очереди, MULTI — через `readyMulti`); на офлайн-точке клиента нет
(`null`):

```typescript
// apps/api/src/core/redis/redis.module.ts (abridged)
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisClient | null =>
        config.getOrThrow<string>('STORE_MODE') === 'cloud'
          ? createRedisClient(config.getOrThrow<string>('REDIS_URL'))
          : null,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

`PlatformDatabaseModule` **не** глобальный и не подключается в `AppModule` — его импортируют
только модули `app/platform/**` и `app/sync/**` (ADR-0013). Доступ к данным —
`nestjs-config-data-access.md`; health — `nestjs-enterprise-infrastructure.md`.
