import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { TerminalsModule } from '../terminals/terminals.module';
import { CatalogSnapshotController } from './catalog-snapshot.controller';
import { CatalogSnapshotService } from './catalog-snapshot.service';
import { DeploymentController } from './deployment.controller';
import { HeldReceiptsController } from './held-receipts.controller';
import { HeldReceiptsService } from './held-receipts.service';
import { PosIdempotency } from './idempotency';
import { PosAlerts } from './pos-alerts';
import { PosContext } from './pos-context';
import { PosShifts } from './pos-shifts';
import { PosRepository } from './pos.repository';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsRepository } from './receipts.repository';
import { ReceiptsService } from './receipts.service';
import { ShiftMapper } from './shift-mapper';
import { ShiftReturns } from './shift-returns';
import { ShiftsController } from './shifts.controller';
import { ShiftsRepository } from './shifts.repository';
import { ShiftsService } from './shifts.service';
import { SoldReceipts } from './sold-receipts';

// The POS of a cloud store (spec 2026-10-13-pos-shift-sale): catalog snapshot, shifts, receipts and
// held receipts. Cloud only: the POS of an offline store comes with the sync (ADR-0014). Catalog,
// prices and stock come through the exports of catalog, pricing and inventory (ADR-0002); the
// terminals module asks the open shift through the revocation checks the POS registers. The
// customer returns (spec 2026-10-13-customer-returns, E16) read the sold receipt and the open shift
// through `SoldReceipts` and `PosShifts`, and fill the returns of a shift through `ShiftReturns`.
// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`.
@Module({
  imports: [
    AuditModule,
    AuthModule,
    CatalogModule,
    PricingModule,
    InventoryModule,
    TerminalsModule,
  ],
  controllers: [
    CatalogSnapshotController,
    DeploymentController,
    ShiftsController,
    HeldReceiptsController,
    ReceiptsController,
  ],
  providers: [
    PosRepository,
    PosIdempotency,
    PosContext,
    CatalogSnapshotService,
    ShiftsRepository,
    ShiftMapper,
    ShiftsService,
    HeldReceiptsService,
    ReceiptsRepository,
    ReceiptsService,
    ShiftReturns,
    SoldReceipts,
    PosShifts,
    PosAlerts,
  ],
  // PosAlerts — the POS events of the notifications (spec 2026-10-14-owner-cabinet)
  exports: [
    PosContext,
    PosIdempotency,
    ShiftReturns,
    SoldReceipts,
    PosShifts,
    PosAlerts,
  ],
})
export class PosModule {}
