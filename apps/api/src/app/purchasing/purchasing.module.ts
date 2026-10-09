import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentAllocation } from './allocation';
import { OrderReceiving } from './order-receiving';
import { PaymentsService } from './payments.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersRepository } from './purchase-orders.repository';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchasingRepository } from './purchasing.repository';
import { SupplierLedger } from './supplier-ledger';
import { SuppliersController } from './suppliers.controller';
import { SuppliersReader } from './suppliers-reader';
import { SuppliersService } from './suppliers.service';

// Purchasing (spec 2026-10-09-inventory-purchasing, section 5): suppliers, their ledger and
// payments with their allocation to goods receipts, purchase orders.
// Cloud only. The stock module reads suppliers and writes the debt of a goods receipt only through
// SuppliersReader, SupplierLedger and OrderReceiving (ADR-0002); purchasing depends on no stock
// module and reads products through the catalog.
@Module({
  imports: [AuditModule, CatalogModule],
  controllers: [SuppliersController, PurchaseOrdersController],
  providers: [
    PurchasingRepository,
    SuppliersService,
    SuppliersReader,
    SupplierLedger,
    PaymentAllocation,
    PaymentsService,
    PurchaseOrdersRepository,
    PurchaseOrdersService,
    OrderReceiving,
  ],
  exports: [SuppliersReader, SupplierLedger, OrderReceiving],
})
export class PurchasingModule {}
