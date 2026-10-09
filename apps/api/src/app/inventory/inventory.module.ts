import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { DocumentsRepository } from './documents.repository';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { InventoryRepository } from './inventory.repository';
import { Numbering } from './numbering';
import { OpeningBalancesController } from './opening-balances.controller';
import { DocumentPosting } from './posting';
import { StockDocumentsService } from './stock-documents.service';
import { UnpostingCheckController } from './unposting-check.controller';

// The stock (spec 2026-10-09-inventory-purchasing, section 4): batches, documents and movements.
// Cloud only for now: an offline store posts its own documents (ADR-0014). Products, store prices
// and suppliers come through the exports of catalog, pricing and purchasing (ADR-0002).
@Module({
  imports: [AuditModule, CatalogModule, PricingModule, PurchasingModule],
  controllers: [
    GoodsReceiptsController,
    OpeningBalancesController,
    UnpostingCheckController,
  ],
  providers: [
    InventoryRepository,
    DocumentsRepository,
    Numbering,
    DocumentPosting,
    StockDocumentsService,
  ],
})
export class InventoryModule {}
