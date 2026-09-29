import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';
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
})
export class AppModule {}
