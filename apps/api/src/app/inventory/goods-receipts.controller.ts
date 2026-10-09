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
  GoodsReceipt,
  GoodsReceiptListResponse,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  DocumentListQueryDto,
  GoodsReceiptInputDto,
} from './dto/documents.dto';
import { StockDocumentsService } from './stock-documents.service';

// Goods receipts (spec 2026-10-09-inventory-purchasing, section 4.1).
@Controller({ path: 'goods-receipts', version: '1' })
export class GoodsReceiptsController {
  constructor(private readonly documents: StockDocumentsService) {}

  @RequirePermission('inventory:view')
  @Get()
  list(
    @Query() query: DocumentListQueryDto,
  ): Promise<GoodsReceiptListResponse> {
    return this.documents.listReceipts(query);
  }

  /** Needs `finance:view-cost` as well. */
  @RequirePermission('inventory:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<GoodsReceipt> {
    return this.documents.getReceipt(id);
  }

  /** 201 — a draft with its number. */
  @RequirePermission('inventory:create')
  @Post()
  create(@Body() body: GoodsReceiptInputDto): Promise<GoodsReceipt> {
    return this.documents.createReceipt(body);
  }

  /** Only a draft: 409 `document_posted`. */
  @RequirePermission('inventory:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: GoodsReceiptInputDto,
  ): Promise<GoodsReceipt> {
    return this.documents.updateReceipt(id, body);
  }

  /** 409 `document_posted` / `product_archived`, 422 `validation_failed` / `period_closed` / `above_max_price`. */
  @RequirePermission('inventory:post')
  @HttpCode(HttpStatus.OK)
  @Post(':id/posting')
  post(@Param('id', new ParseUUIDPipe()) id: string): Promise<GoodsReceipt> {
    return this.documents.post('goods_receipt', id) as Promise<GoodsReceipt>;
  }

  /** 409 `unpost_blocked` / `document_not_posted`. */
  @RequirePermission('inventory:unpost')
  @HttpCode(HttpStatus.OK)
  @Post(':id/unposting')
  unpost(@Param('id', new ParseUUIDPipe()) id: string): Promise<GoodsReceipt> {
    return this.documents.unpost('goods_receipt', id) as Promise<GoodsReceipt>;
  }
}
