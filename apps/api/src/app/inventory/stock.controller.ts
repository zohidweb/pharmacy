import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type {
  ProductBatchRow,
  StockListResponse,
  StockProductOption,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { StockListQueryDto, StockProductsQueryDto } from './dto/stock.dto';
import { StockService } from './stock.service';

// Stock of the stores (spec 2026-10-09-inventory-purchasing, section 4.2).
@Controller({ version: '1' })
export class StockController {
  constructor(private readonly stock: StockService) {}

  @RequirePermission('inventory:view')
  @Get('stock')
  list(@Query() query: StockListQueryDto): Promise<StockListResponse> {
    return this.stock.list(query);
  }

  /** Batches of a product with stock in the stores of the scope (the product card). */
  @RequirePermission('inventory:view')
  @Get('stock/products/:productId/batches')
  productBatches(
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ): Promise<ProductBatchRow[]> {
    return this.stock.productBatches(productId);
  }

  /** Products for the lines of a document with the batches of the store (FEFO). */
  @RequirePermission('inventory:view')
  @Get('stores/:storeId/stock-products')
  products(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Query() query: StockProductsQueryDto,
  ): Promise<StockProductOption[]> {
    return this.stock.productOptions(storeId, query);
  }
}
