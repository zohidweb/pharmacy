import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PosModule } from '../pos/pos.module';
import { PricingModule } from '../pricing/pricing.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ReturnsModule } from '../returns/returns.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesRepository } from './expenses.repository';
import { ExpensesService } from './expenses.service';
import { NavCountersController } from './nav-counters.controller';
import { NavCountersService } from './nav-counters.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

// The home and the reports of the owner cabinet (spec 2026-10-14-owner-cabinet, E17). Cloud only:
// the figures of the other domains come through their exports — the sales (SalesFigures), the
// refunds (ReturnFigures), the stock signals and figures (StockAlerts, StockFigures), the supplier
// debts (SupplierDues), the reminders and the journal. The other expenses (E16) are its own table;
// the cash withdrawals «на расходы» come from SalesFigures. The menu counters (spec
// 2026-10-15-nav-counters) add the price problems of the pricing module (PriceProblems).
@Module({
  imports: [
    AuditModule,
    AuthModule,
    PosModule,
    ReturnsModule,
    InventoryModule,
    NotificationsModule,
    PurchasingModule,
    PricingModule,
  ],
  controllers: [
    DashboardController,
    ReportsController,
    ExpensesController,
    NavCountersController,
  ],
  providers: [
    ReportsRepository,
    DashboardService,
    ReportsService,
    ExpensesRepository,
    ExpensesService,
    NavCountersService,
  ],
})
export class ReportsModule {}
