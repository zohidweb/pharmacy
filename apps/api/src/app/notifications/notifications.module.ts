import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosModule } from '../pos/pos.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRefresh } from './notifications-refresh';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { Reminders } from './reminders';

// The notifications of the network (spec 2026-10-14-owner-cabinet, E9–E13). Cloud only, as the
// modules it reads: the stock signals, the supplier payments due and the POS events come through
// their exports (StockAlerts, SupplierDues, PosAlerts); the reports module reads Reminders.
@Module({
  imports: [
    AuditModule,
    AuthModule,
    InventoryModule,
    PurchasingModule,
    PosModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsRefresh,
    NotificationsService,
    Reminders,
  ],
  exports: [Reminders],
})
export class NotificationsModule {}
