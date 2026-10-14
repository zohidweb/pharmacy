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
  PurchaseOrder,
  PurchaseOrderListResponse,
  PurchaseOrderOption,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  OpenPurchaseOrdersQueryDto,
  PurchaseOrderInputDto,
  PurchaseOrderListQueryDto,
} from './dto/purchasing.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

// Purchase orders to suppliers (spec 2026-10-09-inventory-purchasing, section 5.3). The deficit of
// an order is the stock module's (`GET /stock/deficit`); the static paths here come before `:id`.
@Controller({ path: 'purchase-orders', version: '1' })
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  /** Orders with the KPI by status; totals only with `finance:view-cost`. */
  @RequirePermission('purchasing:view')
  @Get()
  list(
    @Query() query: PurchaseOrderListQueryDto,
  ): Promise<PurchaseOrderListResponse> {
    return this.orders.list(query);
  }

  /** Confirmed and partially received orders of a supplier for a goods receipt; needs the cost. */
  @RequirePermission('inventory:view')
  @Get('open')
  open(
    @Query() query: OpenPurchaseOrdersQueryDto,
  ): Promise<PurchaseOrderOption[]> {
    return this.orders.open(query.supplierId);
  }

  /** Needs `finance:view-cost` as well. */
  @RequirePermission('purchasing:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<PurchaseOrder> {
    return this.orders.get(id);
  }

  /** A draft; needs `finance:view-cost` as well. 400, 403, 409 `product_archived`. */
  @RequirePermission('purchasing:create')
  @Post()
  create(@Body() body: PurchaseOrderInputDto): Promise<PurchaseOrder> {
    return this.orders.create(body);
  }

  /** Only a draft: 409 `order_not_editable`; needs `finance:view-cost` as well. */
  @RequirePermission('purchasing:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PurchaseOrderInputDto,
  ): Promise<PurchaseOrder> {
    return this.orders.update(id, body);
  }

  /**
   * draft → confirmed; needs `finance:view-cost` as well (the answer is the order with its prices).
   * 409 `order_not_editable`, 422 for a line without a price.
   */
  @RequirePermission('purchasing:post')
  @Post(':id/confirmation')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PurchaseOrder> {
    return this.orders.confirm(id);
  }
}
