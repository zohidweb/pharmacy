import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { CustomerReturnNumbers } from './customer-return-numbers';
import { DeficitController } from './deficit.controller';
import { DocumentsRepository } from './documents.repository';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { InventoryRepository } from './inventory.repository';
import { Numbering } from './numbering';
import { PosStock } from './pos-stock';
import { ReturnStock } from './return-stock';
import { OpeningBalancesController } from './opening-balances.controller';
import { DocumentPosting } from './posting';
import { PurchasePricesSource } from './purchase-prices-source';
import { StockedProductsSource } from './stocked-products-source';
import { StockDocumentsService } from './stock-documents.service';
import { StockAlerts } from './stock-alerts';
import { StockFigures } from './stock-figures';
import { StockController } from './stock.controller';
import { StockCountPosting } from './stock-count-posting';
import { StockCountsController } from './stock-counts.controller';
import { StockCountsRepository } from './stock-counts.repository';
import { StockCountsService } from './stock-counts.service';
import { StoreClosingTransfers } from './store-closing-transfers';
import { TransferAcceptance } from './transfer-acceptance';
import { StockFreeze } from './stock-freeze';
import { StoreAccess } from './store-access';
import { SupplierReturnPosting } from './supplier-return-posting';
import { SupplierReturnsController } from './supplier-returns.controller';
import { SupplierReturnsRepository } from './supplier-returns.repository';
import { SupplierReturnsService } from './supplier-returns.service';
import { TransferMapper } from './transfer-mapper';
import { TransferPosting } from './transfer-posting';
import { TransferRequestsController } from './transfer-requests.controller';
import { TransferRequestsService } from './transfer-requests.service';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { TransfersService } from './transfers.service';
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
    TransfersController,
    TransferRequestsController,
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
    TransfersRepository,
    TransferMapper,
    TransferPosting,
    TransfersService,
    TransferRequestsService,
    PosStock,
    ReturnStock,
    CustomerReturnNumbers,
    // fills the PurchasePrices port of pricing (spec 2026-10-14-owner-cabinet, E15)
    PurchasePricesSource,
    // fills the StockedProducts port of pricing (spec 2026-10-15-nav-counters, E6)
    StockedProductsSource,
    StockAlerts,
    StockFigures,
    StoreClosingTransfers,
    TransferAcceptance,
  ],
  // the POS reads and moves the stock only through these (spec 2026-10-13-pos-shift-sale)
  // StockAlerts, StockFigures — the stock signals and figures of the notifications, the home and the
  // reports (spec 2026-10-14-owner-cabinet)
  // StoreClosingTransfers, TransferAcceptance — the stock side of the closing of a store and the port
  // that tells it the acceptance of a transfer (spec 2026-10-15-store-closing)
  exports: [
    Numbering,
    PosStock,
    ReturnStock,
    CustomerReturnNumbers,
    StockAlerts,
    StockFigures,
    StoreClosingTransfers,
    TransferAcceptance,
  ],
})
export class InventoryModule {}
