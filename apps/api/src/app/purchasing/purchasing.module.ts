import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentAllocation } from './allocation';
import { PaymentsService } from './payments.service';
import { PurchasingRepository } from './purchasing.repository';
import { SupplierLedger } from './supplier-ledger';
import { SuppliersController } from './suppliers.controller';
import { SuppliersReader } from './suppliers-reader';
import { SuppliersService } from './suppliers.service';

// Purchasing (spec 2026-10-09-inventory-purchasing, section 5): suppliers, their ledger and
// payments with their allocation to goods receipts.
// Cloud only. The stock module reads suppliers and writes the debt of a goods receipt only through
// SuppliersReader and SupplierLedger (ADR-0002); purchasing depends on no stock module.
@Module({
  imports: [AuditModule],
  controllers: [SuppliersController],
  providers: [
    PurchasingRepository,
    SuppliersService,
    SuppliersReader,
    SupplierLedger,
    PaymentAllocation,
    PaymentsService,
  ],
  exports: [SuppliersReader, SupplierLedger],
})
export class PurchasingModule {}
