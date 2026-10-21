import { Module } from '@nestjs/common';
import { CatalogFeed } from './catalog-feed';
import { SyncCoreModule } from '../../core/sync';
import { AuditModule } from '../audit/audit.module';
import { CatalogFacts } from './catalog-facts';
import { CatalogImportService } from './catalog-import.service';
import { CatalogImportsController } from './catalog-imports.controller';
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
  imports: [AuditModule, SyncCoreModule],
  controllers: [
    ProductsController,
    CategoriesController,
    MarkupsController,
    CatalogImportsController,
  ],
  providers: [
    CatalogRepository,
    ProductsService,
    CategoriesService,
    ProductsReader,
    CatalogFacts,
    CatalogFeed,
    CatalogImportService,
  ],
  exports: [ProductsReader],
})
export class CatalogModule {}
