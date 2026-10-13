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
} from '@nestjs/common';
import type { TransferRequest } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import {
  RejectTransferRequestDto,
  TransferRequestInputDto,
} from './dto/transfers.dto';
import { TransferRequestsService } from './transfer-requests.service';

// Transfer requests (spec 2026-10-12-supplier-returns-transfers, 5.1–5.2); the list is in
// GET /transfers/overview.
@Controller({ path: 'transfer-requests', version: '1' })
export class TransferRequestsController {
  constructor(private readonly requests: TransferRequestsService) {}

  @RequirePermission('inventory:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<TransferRequest> {
    return this.requests.get(id);
  }

  /** 201 — a draft (or sent with `send`); 400 at `fromStoreId`, `lines.i.productId`. */
  @RequirePermission('inventory:create')
  @Post()
  create(@Body() body: TransferRequestInputDto): Promise<TransferRequest> {
    return this.requests.create(body);
  }

  /** Only a draft: 409 `document_posted`. */
  @RequirePermission('inventory:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TransferRequestInputDto,
  ): Promise<TransferRequest> {
    return this.requests.update(id, body);
  }

  /** Only a draft: 409 `document_posted`. */
  @RequirePermission('inventory:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.requests.remove(id);
  }

  @RequirePermission('inventory:create')
  @HttpCode(HttpStatus.OK)
  @Post(':id/sending')
  send(@Param('id', new ParseUUIDPipe()) id: string): Promise<TransferRequest> {
    return this.requests.send(id);
  }

  /** The asked store: 409 `request_not_open`; 400 `comment` for `other`. */
  @RequirePermission('inventory:post')
  @HttpCode(HttpStatus.OK)
  @Post(':id/rejection')
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RejectTransferRequestDto,
  ): Promise<TransferRequest> {
    return this.requests.reject(id, body);
  }
}
