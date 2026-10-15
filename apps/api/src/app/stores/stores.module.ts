import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosModule } from '../pos/pos.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { LegalEntitiesController } from './legal-entities.controller';
import { LegalEntitiesService } from './legal-entities.service';
import { NetworkSettingsRepository } from './network-settings.repository';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StoreClosingController } from './store-closing.controller';
import { StoreClosingService } from './store-closing.service';
import { StoresController } from './stores.controller';
import { StoresRepository } from './stores.repository';
import { StoresService } from './stores.service';

// Stores and legal entities of the owner (spec 2026-10-06-owner-stores) and the network settings of
// the owner cabinet (spec 2026-10-14-owner-cabinet, E14). Cloud only: an offline
// store receives them by the change feed (ADR-0014). TenantDatabase comes from the global
// DatabaseModule. The closing of a store (spec 2026-10-15-store-closing) takes the stock side from
// inventory, the open shifts from pos and the open orders and debts from purchasing, by their exports.
@Module({
  imports: [AuditModule, InventoryModule, PosModule, PurchasingModule],
  controllers: [
    StoresController,
    StoreClosingController,
    LegalEntitiesController,
    SettingsController,
  ],
  providers: [
    StoresRepository,
    StoresService,
    StoreClosingService,
    LegalEntitiesService,
    NetworkSettingsRepository,
    SettingsService,
  ],
})
export class StoresModule {}
