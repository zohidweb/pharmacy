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
import type { Transfer, TransferOverview } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  AcceptTransferDto,
  TransferInputDto,
  TransferOverviewQueryDto,
} from './dto/transfers.dto';
import { TransfersService } from './transfers.service';

// Transfers between cloud stores (spec 2026-10-12-supplier-returns-transfers, 5.1, 5.3–5.4).
@Controller({ path: 'transfers', version: '1' })
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @RequirePermission('inventory:view')
  @Get('overview')
  overview(
    @Query() query: TransferOverviewQueryDto,
  ): Promise<TransferOverview> {
    return this.transfers.overview(query);
  }

  @RequirePermission('inventory:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Transfer> {
    return this.transfers.get(id);
  }

  /**
   * 201 — a draft (sent at once with `send`, which needs `inventory:post`); 400 at the lines
   * (`not_requested`, `exceeds_request`, `unknown_batch`), 409 `request_not_open` /
   * `request_has_transfer` / `offline_store_read_only`.
   */
  @RequirePermission('inventory:create')
  @Post()
  create(@Body() body: TransferInputDto): Promise<Transfer> {
    return this.transfers.create(body);
  }

  /** Only a draft: 409 `document_posted` / `document_cancelled`. */
  @RequirePermission('inventory:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TransferInputDto,
  ): Promise<Transfer> {
    return this.transfers.update(id, body);
  }

  /** 409 `stock_insufficient` / `stock_count_in_progress`, 422 `period_closed`. */
  @RequirePermission('inventory:post')
  @HttpCode(HttpStatus.OK)
  @Post(':id/sending')
  send(@Param('id', new ParseUUIDPipe()) id: string): Promise<Transfer> {
    return this.transfers.send(id);
  }

  /** 409 `transfer_not_in_transit` / `stock_count_in_progress`, 422 `period_closed`. */
  @RequirePermission('inventory:unpost')
  @HttpCode(HttpStatus.OK)
  @Post(':id/recall')
  recall(@Param('id', new ParseUUIDPipe()) id: string): Promise<Transfer> {
    return this.transfers.recall(id);
  }

  /** A draft → `cancelled`. */
  @RequirePermission('inventory:delete')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancellation')
  cancel(@Param('id', new ParseUUIDPipe()) id: string): Promise<Transfer> {
    return this.transfers.cancel(id);
  }

  /** The receiver: 409 `transfer_not_in_transit` / `stock_count_in_progress` / `transfer_changed`. */
  @RequirePermission('inventory:receive')
  @HttpCode(HttpStatus.OK)
  @Post(':id/acceptance')
  accept(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AcceptTransferDto,
  ): Promise<Transfer> {
    return this.transfers.accept(id, body);
  }
}
