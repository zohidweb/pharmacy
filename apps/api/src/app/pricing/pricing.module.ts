import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DiscountRulesController } from './discount-rules.controller';
import { DiscountRulesService } from './discount-rules.service';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';
import { PricingRepository } from './pricing.repository';
import { StorePriceWriter } from './store-price-writer';

// Retail prices of the stores and discount rules (spec 2026-10-07-catalog-pricing). Products come
// from the catalog's ProductsReader (ADR-0002). Cloud only for now (ADR-0014: price conflicts of
// offline stores come with the sync).
@Module({
  imports: [AuditModule, CatalogModule],
  controllers: [PricesController, DiscountRulesController],
  providers: [
    PricingRepository,
    PricesService,
    DiscountRulesService,
    StorePriceWriter,
  ],
  exports: [StorePriceWriter],
})
export class PricingModule {}
