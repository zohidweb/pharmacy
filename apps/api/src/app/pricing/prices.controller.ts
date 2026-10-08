import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import type {
  PriceListResponse,
  PriceRow,
  StorePrice,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { PriceListQueryDto, UpdatePricesDto } from './dto/pricing.dto';
import { PricesService } from './prices.service';

// Retail prices by store (spec 2026-10-07-catalog-pricing, section 6).
@Controller({ path: 'prices', version: '1' })
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @RequirePermission('pricing:view')
  @Get()
  list(@Query() query: PriceListQueryDto): Promise<PriceListResponse> {
    return this.prices.list(query);
  }

  @RequirePermission('pricing:view')
  @Get(':productId')
  ofProduct(
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ): Promise<StorePrice[]> {
    return this.prices.ofProduct(productId);
  }

  /**
   * The service also needs pricing:update-store (stores of the scope) or pricing:update-network.
   * 403 `forbidden` / `store_not_in_scope`, 404, 409 `product_archived`, 422 `above_max_price`.
   */
  @RequirePermission('pricing:view')
  @Put(':productId')
  update(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() body: UpdatePricesDto,
  ): Promise<PriceRow> {
    return this.prices.update(productId, body);
  }
}
