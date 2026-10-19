import { Module } from '@nestjs/common';
import { SyncCoreModule } from '../../core/sync';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DiscountRulesController } from './discount-rules.controller';
import { DiscountRulesService } from './discount-rules.service';
import { PriceFacts } from './price-facts';
import { PricesController } from './prices.controller';
import { PriceProblems } from './price-problems';
import { PricesService } from './prices.service';
import { PricingRepository } from './pricing.repository';
import { PurchasePrices } from './purchase-prices';
import { StoreDiscountDetachment } from './store-discount-detachment';
import { StorePriceWriter } from './store-price-writer';
import { StorePricesReader } from './store-prices-reader';
import { StockedProducts } from './stocked-products';

// Retail prices of the stores and discount rules (spec 2026-10-07-catalog-pricing). Products come
// from the catalog's ProductsReader (ADR-0002). Cloud only for now (ADR-0014: price conflicts of
// offline stores come with the sync).
@Module({
  imports: [AuditModule, CatalogModule, SyncCoreModule],
  controllers: [PricesController, DiscountRulesController],
  providers: [
    PricingRepository,
    PricesService,
    DiscountRulesService,
    StorePriceWriter,
    StorePricesReader,
    PurchasePrices,
    StoreDiscountDetachment,
    StockedProducts,
    PriceFacts,
    PriceProblems,
  ],
  // PurchasePrices — a port the inventory module fills (spec 2026-10-14-owner-cabinet, E15)
  // StoreDiscountDetachment — the stores module takes a closed store out of the discount rules
  // (spec 2026-10-15-store-closing, E12)
  // StockedProducts — a port the inventory module fills; PriceProblems — the price problems of the menu
  // counter (spec 2026-10-15-nav-counters, E6)
  exports: [
    StorePriceWriter,
    StorePricesReader,
    PurchasePrices,
    StoreDiscountDetachment,
    StockedProducts,
    PriceProblems,
  ],
})
export class PricingModule {}
