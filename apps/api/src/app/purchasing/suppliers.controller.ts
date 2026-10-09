import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  SupplierCard,
  SupplierListItem,
  SupplierListResponse,
  SupplierOption,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { SupplierInputDto, SupplierListQueryDto } from './dto/purchasing.dto';
import { SuppliersService } from './suppliers.service';

// Suppliers of the network (spec 2026-10-09-inventory-purchasing, section 5.1).
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

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
}
