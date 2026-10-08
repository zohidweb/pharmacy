import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogRepository } from './catalog.repository';
import {
  CategoriesController,
  MarkupsController,
} from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductsController } from './products.controller';
import { ProductsReader } from './products-reader';
import { ProductsService } from './products.service';

// Catalog of the network (spec 2026-10-07-catalog-pricing): products, barcodes, categories, dosage
// forms and markups. Cloud only for now: an offline store gets the catalog by the change feed
// (ADR-0014). Other modules read products only through ProductsReader (ADR-0002).
@Module({
  imports: [AuditModule],
  controllers: [ProductsController, CategoriesController, MarkupsController],
  providers: [
    CatalogRepository,
    ProductsService,
    CategoriesService,
    ProductsReader,
  ],
  exports: [ProductsReader],
})
export class CatalogModule {}
