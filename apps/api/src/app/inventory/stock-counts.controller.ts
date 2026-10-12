import {
  Body,
  Controller,
  Delete,
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
  StockCount,
  StockCountLine,
  StockCountListItem,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  FoundLineDto,
  SaveStockCountDto,
  StartStockCountDto,
  StockCountEntryDto,
  StockCountListQueryDto,
} from './dto/stock-counts.dto';
import { StockCountsService } from './stock-counts.service';

// Stock counts (spec 2026-10-12-write-offs-stock-counts, section 5). Costs only with
// `finance:view-cost`.
@Controller({ path: 'stock-counts', version: '1' })
export class StockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @RequirePermission('inventory:view')
  @Get()
  list(@Query() query: StockCountListQueryDto): Promise<{
    items: StockCountListItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.counts.list(query);
  }

  @RequirePermission('inventory:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<StockCount> {
    return this.counts.get(id);
  }

  /** The snapshot of the book stock; freezes the scope. 409 `stock_count_in_progress`. */
  @RequirePermission('inventory:post')
  @Post()
  start(@Body() body: StartStockCountDto): Promise<StockCount> {
    return this.counts.start(body);
  }

  /** The comment of a running count. */
  @RequirePermission('inventory:update')
  @Put(':id')
  save(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SaveStockCountDto,
  ): Promise<StockCount> {
    return this.counts.saveComment(id, body.comment);
  }

  /** An entry of a tablet; the same id repeated — the same line, another body — 409. */
  @RequirePermission('inventory:update')
  @HttpCode(HttpStatus.OK)
  @Post(':id/entries')
  addEntry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: StockCountEntryDto,
  ): Promise<StockCountLine> {
    return this.counts.addEntry(id, body);
  }

  /** One's own entry; another one's with `inventory:post`. */
  @RequirePermission('inventory:update')
  @Delete(':id/entries/:entryId')
  deleteEntry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<StockCountLine> {
    return this.counts.deleteEntry(id, entryId);
  }

  /** A product found without a book batch; 409 `product_archived`. */
  @RequirePermission('inventory:update')
  @Post(':id/found-lines')
  addFoundLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: FoundLineDto,
  ): Promise<StockCount> {
    return this.counts.addFoundLine(id, body);
  }

  @RequirePermission('inventory:update')
  @Put(':id/found-lines/:lineId')
  updateFoundLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() body: FoundLineDto,
  ): Promise<StockCount> {
    return this.counts.updateFoundLine(id, lineId, body);
  }

  /** Only while the line has no entries. */
  @RequirePermission('inventory:update')
  @Delete(':id/found-lines/:lineId')
  deleteFoundLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
  ): Promise<StockCount> {
    return this.counts.deleteFoundLine(id, lineId);
  }

  /** 422 `validation_failed` at the lines / `period_closed`, 409 `document_posted`. */
  @RequirePermission('inventory:post')
  @HttpCode(HttpStatus.OK)
  @Post(':id/posting')
  post(@Param('id', new ParseUUIDPipe()) id: string): Promise<StockCount> {
    return this.counts.post(id);
  }

  /** 409 `unpost_blocked` / `stock_count_in_progress` / `document_not_posted`. */
  @RequirePermission('inventory:unpost')
  @HttpCode(HttpStatus.OK)
  @Post(':id/unposting')
  unpost(@Param('id', new ParseUUIDPipe()) id: string): Promise<StockCount> {
    return this.counts.unpost(id);
  }

  /** A running count closes without movements. */
  @RequirePermission('inventory:delete')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancellation')
  cancel(@Param('id', new ParseUUIDPipe()) id: string): Promise<StockCount> {
    return this.counts.cancel(id);
  }
}
