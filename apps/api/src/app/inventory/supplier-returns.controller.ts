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
  SupplierReturn,
  SupplierReturnListResponse,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  SupplierReturnInputDto,
  SupplierReturnListQueryDto,
} from './dto/supplier-returns.dto';
import { SupplierReturnsService } from './supplier-returns.service';

// Supplier returns (spec 2026-10-12-supplier-returns-transfers, section 4). Amounts only with
// `finance:view-cost`; writing a draft does not need it.
@Controller({ path: 'supplier-returns', version: '1' })
export class SupplierReturnsController {
  constructor(private readonly returns: SupplierReturnsService) {}

  @RequirePermission('inventory:view')
  @Get()
  list(
    @Query() query: SupplierReturnListQueryDto,
  ): Promise<SupplierReturnListResponse> {
    return this.returns.list(query);
  }

  @RequirePermission('inventory:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<SupplierReturn> {
    return this.returns.get(id);
  }

  /** 201 — a draft with its number; 400 at `supplierId`, `receiptId`, `lines.i.batchId` / `unit`. */
  @RequirePermission('inventory:create')
  @Post()
  create(@Body() body: SupplierReturnInputDto): Promise<SupplierReturn> {
    return this.returns.create(body);
  }

  /** Only a draft: 409 `document_posted`. */
  @RequirePermission('inventory:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SupplierReturnInputDto,
  ): Promise<SupplierReturn> {
    return this.returns.update(id, body);
  }

  /**
   * 409 `document_posted` / `stock_insufficient` / `stock_count_in_progress`, 422
   * `validation_failed` / `period_closed`.
   */
  @RequirePermission('inventory:post')
  @HttpCode(HttpStatus.OK)
  @Post(':id/posting')
  post(@Param('id', new ParseUUIDPipe()) id: string): Promise<SupplierReturn> {
    return this.returns.post(id);
  }

  /** 409 `unpost_blocked` / `document_not_posted` / `stock_count_in_progress`, 422 `period_closed`. */
  @RequirePermission('inventory:unpost')
  @HttpCode(HttpStatus.OK)
  @Post(':id/unposting')
  unpost(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SupplierReturn> {
    return this.returns.unpost(id);
  }
}
