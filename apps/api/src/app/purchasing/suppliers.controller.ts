import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  SupplierCard,
  SupplierLedgerEntry,
  SupplierListItem,
  SupplierListResponse,
  SupplierOption,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  SupplierInputDto,
  SupplierListQueryDto,
  SupplierPaymentDto,
} from './dto/purchasing.dto';
import { PaymentsService } from './payments.service';
import { SuppliersService } from './suppliers.service';

// Suppliers of the network and payments to them (spec 2026-10-09-inventory-purchasing, 5.1–5.2).
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly payments: PaymentsService,
  ) {}

  /** Active suppliers for the documents of the stock. */
  @RequirePermission('inventory:view')
  @Get('options')
  options(): Promise<SupplierOption[]> {
    return this.suppliers.options();
  }

  @RequirePermission('purchasing:view')
  @Get()
  list(@Query() query: SupplierListQueryDto): Promise<SupplierListResponse> {
    return this.suppliers.list(query);
  }

  /** The card with the receipts and the ledger; needs `finance:view-cost` as well. */
  @RequirePermission('purchasing:view')
  @Get(':id')
  card(@Param('id', new ParseUUIDPipe()) id: string): Promise<SupplierCard> {
    return this.suppliers.card(id);
  }

  /** 201; 409 `supplier_name_taken`. */
  @RequirePermission('purchasing:create')
  @Post()
  create(@Body() body: SupplierInputDto): Promise<SupplierListItem> {
    return this.suppliers.create(body);
  }

  /** 404, 409 `supplier_name_taken`. */
  @RequirePermission('purchasing:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SupplierInputDto,
  ): Promise<SupplierListItem> {
    return this.suppliers.update(id, body);
  }

  /**
   * The ledger entry of the payment; needs `finance:view-cost` as well. A repeat of the same `id`
   * with the same body returns the same entry. 400 (`legalEntityId` required when the network has
   * several active legal entities, `date` in the future), 404, 409 `idempotency_conflict`.
   */
  @RequirePermission('purchasing:post')
  @Post(':id/payments')
  @HttpCode(HttpStatus.OK)
  pay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SupplierPaymentDto,
  ): Promise<SupplierLedgerEntry> {
    return this.payments.pay(id, body);
  }
}
