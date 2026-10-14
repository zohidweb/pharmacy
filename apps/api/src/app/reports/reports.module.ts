import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PosModule } from '../pos/pos.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ReturnsModule } from '../returns/returns.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesRepository } from './expenses.repository';
import { ExpensesService } from './expenses.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

// The home and the reports of the owner cabinet (spec 2026-10-14-owner-cabinet, E17). Cloud only:
// the figures of the other domains come through their exports — the sales (SalesFigures), the
// refunds (ReturnFigures), the stock signals and figures (StockAlerts, StockFigures), the supplier
// debts (SupplierDues), the reminders and the journal. The other expenses (E16) are its own table;
// the cash withdrawals «на расходы» come from SalesFigures.
@Module({
  imports: [
    AuditModule,
    AuthModule,
    PosModule,
    ReturnsModule,
    InventoryModule,
    NotificationsModule,
    PurchasingModule,
  ],
  controllers: [DashboardController, ReportsController, ExpensesController],
  providers: [
    ReportsRepository,
    DashboardService,
    ReportsService,
    ExpensesRepository,
    ExpensesService,
  ],
})
export class ReportsModule {}
