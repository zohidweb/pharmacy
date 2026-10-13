import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { DeficitController } from './deficit.controller';
import { DocumentsRepository } from './documents.repository';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { InventoryRepository } from './inventory.repository';
import { Numbering } from './numbering';
import { OpeningBalancesController } from './opening-balances.controller';
import { DocumentPosting } from './posting';
import { StockDocumentsService } from './stock-documents.service';
import { StockController } from './stock.controller';
import { StockCountPosting } from './stock-count-posting';
import { StockCountsController } from './stock-counts.controller';
import { StockCountsRepository } from './stock-counts.repository';
import { StockCountsService } from './stock-counts.service';
import { StockFreeze } from './stock-freeze';
import { StoreAccess } from './store-access';
import { SupplierReturnPosting } from './supplier-return-posting';
import { SupplierReturnsController } from './supplier-returns.controller';
import { SupplierReturnsRepository } from './supplier-returns.repository';
import { SupplierReturnsService } from './supplier-returns.service';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';
import { UnpostingCheckController } from './unposting-check.controller';
import { WriteOffPosting } from './write-off-posting';
import { WriteOffsController } from './write-offs.controller';
import { WriteOffsRepository } from './write-offs.repository';
import { WriteOffsService } from './write-offs.service';

// The stock (spec 2026-10-09-inventory-purchasing, section 4): batches, documents and movements.
// Cloud only for now: an offline store posts its own documents (ADR-0014). Products, store prices
// and suppliers come through the exports of catalog, pricing and purchasing (ADR-0002).
@Module({
  imports: [AuditModule, CatalogModule, PricingModule, PurchasingModule],
  controllers: [
    GoodsReceiptsController,
    OpeningBalancesController,
    UnpostingCheckController,
    StockController,
    DeficitController,
    WriteOffsController,
    StockCountsController,
    SupplierReturnsController,
  ],
  providers: [
    InventoryRepository,
    DocumentsRepository,
    Numbering,
    DocumentPosting,
    StockDocumentsService,
    StockRepository,
    StockService,
    StockFreeze,
    StockCountsRepository,
    StockCountPosting,
    StockCountsService,
    StoreAccess,
    WriteOffsRepository,
    WriteOffPosting,
    WriteOffsService,
    SupplierReturnsRepository,
    SupplierReturnPosting,
    SupplierReturnsService,
  ],
})
export class InventoryModule {}
