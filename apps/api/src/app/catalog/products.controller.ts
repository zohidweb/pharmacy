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
  CatalogListResponse,
  CatalogProduct,
  CatalogReferences,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  CatalogListQueryDto,
  CatalogProductInputDto,
  CatalogStatusDto,
} from './dto/catalog.dto';
import { ProductsService } from './products.service';

// Products of the network (spec 2026-10-07-catalog-pricing, section 5).
@Controller({ path: 'catalog', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @RequirePermission('catalog:view')
  @Get('products')
  list(@Query() query: CatalogListQueryDto): Promise<CatalogListResponse> {
    return this.products.list(query);
  }

  @RequirePermission('catalog:view')
  @Get('products/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<CatalogProduct> {
    return this.products.get(id);
  }

  /** 201; 400 `validation_failed`, 409 `barcode_taken`. */
  @RequirePermission('catalog:create')
  @Post('products')
  create(@Body() body: CatalogProductInputDto): Promise<CatalogProduct> {
    return this.products.create(body);
  }

  /** 400 `validation_failed`, 404, 409 `barcode_taken` / `product_archived`. */
  @RequirePermission('catalog:update')
  @Put('products/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CatalogProductInputDto,
  ): Promise<CatalogProduct> {
    return this.products.update(id, body);
  }

  /** Archive or restore; 200 with the product. */
  @RequirePermission('catalog:delete')
  @HttpCode(HttpStatus.OK)
  @Post('products/:id/status')
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CatalogStatusDto,
  ): Promise<CatalogProduct> {
    return this.products.setStatus(id, body.status);
  }

  @RequirePermission('catalog:view')
  @Get('references')
  references(): Promise<CatalogReferences> {
    return this.products.references();
  }
}
