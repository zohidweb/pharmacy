# NestJS Core Templates — main.ts, AppModule, CoreModule

Шаблоны точки входа и корневых модулей `apps/api` (Express-адаптер по умолчанию).

## main.ts (apps/api/src/main.ts)

```typescript
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app/app.module';
import applicationConfig from './config/application.config';
import securityConfig from './config/security.config';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const appCfg = app.get<ConfigType<typeof applicationConfig>>(applicationConfig.KEY);
  const secCfg = app.get<ConfigType<typeof securityConfig>>(securityConfig.KEY);

  app.use(helmet());
  app.enableCors({
    origin: secCfg.corsOrigins, // explicit list from env, never '*'
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Correlation-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Correlation-Id'],
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }); // -> /api/v1/...
  app.enableShutdownHooks();

  if (appCfg.enableSwagger && appCfg.nodeEnv !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Pharmacy API').setVersion('1').build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  await app.listen(appCfg.port);
  logger.log(`api listening on :${appCfg.port} (mode: ${appCfg.deploymentMode})`);
}

void bootstrap();
```

Заметки:
- Ошибки старта (конфиг, БД) должны ронять процесс — не глушить `catch`-ом.
- `trust proxy` (`app.getHttpAdapter().getInstance().set('trust proxy', 1)`) включать только
  если перед api реально стоит обратный прокси — иначе `req.ip` подделывается заголовком.
- Лимит тела запроса Express по умолчанию 100 KB; для больших чеков/пакетов синхронизации
  задать явно (`bodyParser`-опции `NestFactory.create`) — осознанно, не «на всякий случай».

## AppModule (apps/api/src/app/app.module.ts)

```typescript
import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TenantAwareThrottlerGuard } from '../common/throttling/tenant-aware-throttler.guard';

import { ConfigModule } from '../config/config.module';
import { CoreModule } from '../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ProblemDetailsFilter } from '../common/filters/problem-details.filter';
import { CorrelationIdMiddleware } from '../common/middleware/correlation-id.middleware';

import { AuditModule } from '../modules/audit/audit.module';
import { BillingModule } from '../modules/billing/billing.module';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { Export1cModule } from '../modules/export-1c/export-1c.module';
import { FiscalModule } from '../modules/fiscal/fiscal.module';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { PosModule } from '../modules/pos/pos.module';
import { PricingModule } from '../modules/pricing/pricing.module';
import { PurchasingModule } from '../modules/purchasing/purchasing.module';
import { ReturnsModule } from '../modules/returns/returns.module';
import { SyncModule } from '../modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule,
    CoreModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] }),
    AuthModule,
    AuditModule,
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
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        forbidUnknownValues: true,
        validationError: { target: false, value: false }, // never echo input (may contain PII)
      }),
    },
    // Order matters: authenticate (fills tenant/employee context) -> throttle per employee -> authorize
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: TenantAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

- `SessionAuthGuard` глобальный: маршрут без сессии возможен только с явным `@Public()`
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
    // tenant/employee are added later by SessionAuthGuard
    requestContextStorage.run({ correlationId }, () => next());
  }
}
```

Полная модель контекста (AsyncLocalStorage, пробрасывание в воркеры) —
`nestjs-resilience-context.md`.

## Глобальные модули ядра

`DatabaseModule` уже есть (`apps/api/src/core/database/database.module.ts`, `@Global`,
экспортирует только `TenantDatabase`) и подключён в `AppModule`. Redis и health добавляются
своими модулями по тому же образцу:

```typescript
// apps/api/src/core/redis/redis.module.ts (to be added with sessions)
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service'; // node-redis 6 client, the project's only Redis client

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
```

`PlatformDatabaseModule` **не** глобальный и не подключается в `AppModule` — его импортируют
только модули `app/platform/**` и `app/sync/**` (ADR-0013). Доступ к данным —
`nestjs-config-data-access.md`; health — `nestjs-enterprise-infrastructure.md`.
