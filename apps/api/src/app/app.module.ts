import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConditionalModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProblemDetailsFilter } from '../common/filters/problem-details.filter';
import { AuthGuard } from '../common/guards/auth.guard';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { FreshAuthGuard } from '../common/guards/fresh-auth.guard';
import { CorrelationIdMiddleware } from '../common/middleware/correlation-id.middleware';
import { SessionMiddleware } from '../common/middleware/session.middleware';
import {
  CookieTokenExtractor,
  TokenExtractor,
} from '../common/middleware/token-extractor';
import { PrincipalThrottlerGuard } from '../common/throttling/principal-throttler.guard';
import { RedisThrottlerStorage } from '../common/throttling/redis-throttler.storage';
import { CryptoModule } from '../core/crypto';
import { DatabaseModule } from '../core/database';
import { RedisModule } from '../core/redis/redis.module';
import { REDIS_CLIENT, type RedisClient } from '../core/redis/redis.tokens';
import { SessionsModule } from '../core/sessions';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { StoresModule } from './stores/stores.module';
import { TerminalsModule } from './terminals/terminals.module';
import { OperatorAuthModule } from './platform/auth/operator-auth.module';
import { TenantsModule } from './platform/tenants/tenants.module';
import { OperatorPermissionsGuard } from './platform/auth/operator-permissions.guard';
import { PermissionsGuard } from './auth/permissions.guard';
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

// Default request limit per tracker (the employee id, or the IP of a guest) and minute
// (nestjs-rate-limiting.md); sign-in and activation routes carry a stricter @Throttle.
const DEFAULT_THROTTLE = { name: 'default', ttl: 60_000, limit: 300 };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    CryptoModule,
    RedisModule,
    SessionsModule,
    // The shared Redis storage keeps the counters of all API instances in step; with no Redis
    // client (STORE_MODE=offline, a single process) the in-memory storage of the package is used.
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (client: RedisClient | null) => ({
        throttlers: [DEFAULT_THROTTLE],
        ...(client ? { storage: new RedisThrottlerStorage(client) } : {}),
      }),
    }),
    AuthModule,
    TerminalsModule,
    // The operator contour exists in the cloud only: an offline store registers no /operator/*
    // routes (auth design, section 10).
    ConditionalModule.registerWhen(
      OperatorAuthModule,
      (env: NodeJS.ProcessEnv) => env.STORE_MODE !== 'offline',
    ),
    ConditionalModule.registerWhen(
      TenantsModule,
      (env: NodeJS.ProcessEnv) => env.STORE_MODE !== 'offline',
    ),
    // Stores and legal entities are kept in the cloud only (spec 2026-10-06-owner-stores).
    ConditionalModule.registerWhen(
      StoresModule,
      (env: NodeJS.ProcessEnv) => env.STORE_MODE !== 'offline',
    ),
    // Employees and roles are kept in the cloud only (spec 2026-10-06-staff-design).
    ConditionalModule.registerWhen(
      StaffModule,
      (env: NodeJS.ProcessEnv) => env.STORE_MODE !== 'offline',
    ),
    // Catalog and prices are kept in the cloud only (spec 2026-10-07-catalog-pricing).
    ConditionalModule.registerWhen(
      CatalogModule,
      (env: NodeJS.ProcessEnv) => env.STORE_MODE !== 'offline',
    ),
    InventoryModule,
    PosModule,
    PurchasingModule,
    ConditionalModule.registerWhen(
      PricingModule,
      (env: NodeJS.ProcessEnv) => env.STORE_MODE !== 'offline',
    ),
    ReturnsModule,
    BillingModule,
    SyncModule,
    FiscalModule,
    Export1cModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: TokenExtractor, useClass: CookieTokenExtractor },
    // Global guards run in registration order (auth design 2026-10-02, section 7): the session
    // principal first, then CSRF, the throttler (it tracks by the principal), the permission, and
    // the step-up check last. The order is load-bearing; keep it in one place.
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
    // The correlation id first (the session middleware and the error filter read it), then the
    // session context for every route. A request without a valid session continues as a guest;
    // the guards decide (design, section 7).
    consumer
      .apply(CorrelationIdMiddleware, SessionMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
