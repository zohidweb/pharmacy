import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosModule } from '../pos/pos.module';
import { ReturnPolicyController } from './return-policy.controller';
import { ReturnPolicyService } from './return-policy.service';
import { ReturnableController } from './returnable.controller';
import { ReturnableService } from './returnable.service';
import { ReturnsController } from './returns.controller';
import { ReturnsRepository } from './returns.repository';
import { ReturnsService } from './returns.service';

// Customer returns of a cloud store (spec 2026-10-13-customer-returns): the receipt, the stock and
// the catalog come through the exports of pos, inventory and catalog (E16); the returns of a shift
// and the numbers of the returns reach pos and inventory through the ports they declare and this
// module fills — no cycle. Cloud only, as the POS: the returns of an offline store come with the
// sync (ADR-0014).
// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`.
@Module({
  imports: [AuditModule, AuthModule, CatalogModule, InventoryModule, PosModule],
  controllers: [ReturnsController, ReturnableController, ReturnPolicyController],
  providers: [
    ReturnsRepository,
    ReturnsService,
    ReturnableService,
    ReturnPolicyService,
  ],
})
export class ReturnsModule {}
