import {
  type ExecutionContext,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConditionalModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProblemDetailsFilter } from '../common/filters/problem-details.filter';
import { EXPORT_PAGE, MAX_PAGE_LIMIT } from '../common/pagination';
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
import {
  cloudMode,
  offlineSyncEnabled,
  validateEnv,
} from './config/env.validation';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { StoresModule } from './stores/stores.module';
import { TerminalsModule } from './terminals/terminals.module';
import { OperatorAuthModule } from './platform/auth/operator-auth.module';
import { OperatorAuditModule } from './platform/audit/operator-audit.module';
import { OperatorsModule } from './platform/operators/operators.module';
import { PlatformBillingModule } from './platform/billing/platform-billing.module';
import { PlatformStatsModule } from './platform/stats/platform-stats.module';
import { PlatformNotificationsModule } from './platform/notifications/platform-notifications.module';
import { PlatformRetentionModule } from './platform/retention/platform-retention.module';
import { TenantsModule } from './platform/tenants/tenants.module';
import { OperatorPermissionsGuard } from './platform/auth/operator-permissions.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { PosModule } from './pos/pos.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { PricingModule } from './pricing/pricing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { ReturnsModule } from './returns/returns.module';
import { BillingModule } from './billing/billing.module';
import { SyncReceiveModule } from './sync/sync-receive.module';
import { ImportsCoreModule } from '../core/imports';
import { SyncCoreModule } from '../core/sync';
import { FiscalModule } from './fiscal/fiscal.module';
import { Export1cModule } from './export-1c/export-1c.module';
import { AuditModule } from './audit/audit.module';

// Default request limit per tracker (the employee id, or the IP of a guest) and minute
// (nestjs-rate-limiting.md); sign-in and activation routes carry a stricter @Throttle.
const DEFAULT_THROTTLE = { name: 'default', ttl: 60_000, limit: 300 };

// A page past the screen size of an @ExportPage route is an Excel export (ADR-0015, amendment 2026-10-27): up to
// 20 000 rows, some 200 ordinary pages of work, so it has its own small budget per tracker, route and minute besides
// the default one.
const reflector = new Reflector();
const EXPORT_THROTTLE = {
  name: 'export',
  ttl: 60_000,
  limit: 10,
  skipIf: (context: ExecutionContext) => {
    if (
      context.getType() !== 'http' ||
      !reflector.get<boolean | undefined>(EXPORT_PAGE, context.getHandler())
    ) {
      return true;
    }
    const { query } = context
      .switchToHttp()
      .getRequest<{ query?: Record<string, unknown> }>();
    return !(Number(query?.limit) > MAX_PAGE_LIMIT);
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    SyncCoreModule,
    ImportsCoreModule,
    CryptoModule,
    RedisModule,
    SessionsModule,
    // The shared Redis storage keeps the counters of all API instances in step; with no Redis
    // client (STORE_MODE=offline, a single process) the in-memory storage of the package is used.
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (client: RedisClient | null) => ({
        throttlers: [DEFAULT_THROTTLE, EXPORT_THROTTLE],
        ...(client ? { storage: new RedisThrottlerStorage(client) } : {}),
      }),
    }),
    AuthModule,
    TerminalsModule,
    // The operator contour exists in the cloud only: an offline store registers no /operator/*
    // routes (auth design, section 10).
    ConditionalModule.registerWhen(OperatorAuthModule, cloudMode),
    ConditionalModule.registerWhen(TenantsModule, cloudMode),
    ConditionalModule.registerWhen(OperatorsModule, cloudMode),
    ConditionalModule.registerWhen(OperatorAuditModule, cloudMode),
    ConditionalModule.registerWhen(PlatformBillingModule, cloudMode),
    // The operator dashboard and statistics (spec 2026-10-19-admin-dashboard-stats).
    ConditionalModule.registerWhen(PlatformStatsModule, cloudMode),
    // The notifications of the operators and the menu counters (spec 2026-10-19-operator-notifications).
    ConditionalModule.registerWhen(PlatformNotificationsModule, cloudMode),
    // The hourly purge of the prescription data by the retention term (spec 2026-10-21-pos-offline-limits, P3).
    ConditionalModule.registerWhen(PlatformRetentionModule, cloudMode),
    // Stores and legal entities are kept in the cloud only (spec 2026-10-06-owner-stores).
    ConditionalModule.registerWhen(StoresModule, cloudMode),
    // Employees and roles are kept in the cloud only (spec 2026-10-06-staff-design).
    ConditionalModule.registerWhen(StaffModule, cloudMode),
    // Catalog and prices are kept in the cloud only (spec 2026-10-07-catalog-pricing).
    ConditionalModule.registerWhen(CatalogModule, cloudMode),
    ConditionalModule.registerWhen(InventoryModule, cloudMode),
    // The POS of an offline store comes with the sync (spec 2026-10-13-pos-shift-sale, E19).
    ConditionalModule.registerWhen(PosModule, cloudMode),
    ConditionalModule.registerWhen(PurchasingModule, cloudMode),
    ConditionalModule.registerWhen(PricingModule, cloudMode),
    // Customer returns of a cloud store, as the POS (spec 2026-10-13-customer-returns, E16).
    ConditionalModule.registerWhen(ReturnsModule, cloudMode),
    // The notifications of the owner cabinet read the cloud modules (spec 2026-10-14-owner-cabinet).
    ConditionalModule.registerWhen(NotificationsModule, cloudMode),
    ConditionalModule.registerWhen(ReportsModule, cloudMode),
    // The services the owner orders from the platform (spec 2026-10-15-billing-services, 6.2).
    ConditionalModule.registerWhen(BillingModule, cloudMode),
    // The routes of the offline-store sync: cloud only (a store calls the cloud, never itself, ADR-0014) and only with
    // OFFLINE_SYNC_ENABLED (security review 2026-10-22, decision 7.4). SyncModule itself comes with the retention.
    ConditionalModule.registerWhen(SyncReceiveModule, offlineSyncEnabled),
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
