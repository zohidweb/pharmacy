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
import type { WriteOff, WriteOffListResponse } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { WriteOffInputDto, WriteOffListQueryDto } from './dto/write-offs.dto';
import { WriteOffsService } from './write-offs.service';

// Write-offs (spec 2026-10-12-write-offs-stock-counts, section 4). Amounts only with
// `finance:view-cost`; writing a draft does not need it.
@Controller({ path: 'write-offs', version: '1' })
export class WriteOffsController {
  constructor(private readonly writeOffs: WriteOffsService) {}

  @RequirePermission('inventory:view')
  @Get()
  list(@Query() query: WriteOffListQueryDto): Promise<WriteOffListResponse> {
    return this.writeOffs.list(query);
  }

  @RequirePermission('inventory:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<WriteOff> {
    return this.writeOffs.get(id);
  }

  /** 201 — a draft with its number; 400 at `lines.i.batchId` / `lines.i.unit`. */
  @RequirePermission('inventory:create')
  @Post()
  create(@Body() body: WriteOffInputDto): Promise<WriteOff> {
    return this.writeOffs.create(body);
  }

  /** Only a draft: 409 `document_posted`. */
  @RequirePermission('inventory:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: WriteOffInputDto,
  ): Promise<WriteOff> {
    return this.writeOffs.update(id, body);
  }

  /** 409 `document_posted` / `stock_insufficient`, 422 `validation_failed` / `period_closed`. */
  @RequirePermission('inventory:post')
  @HttpCode(HttpStatus.OK)
  @Post(':id/posting')
  post(@Param('id', new ParseUUIDPipe()) id: string): Promise<WriteOff> {
    return this.writeOffs.post(id);
  }

  /** 409 `unpost_blocked` / `document_not_posted`, 422 `period_closed`. */
  @RequirePermission('inventory:unpost')
  @HttpCode(HttpStatus.OK)
  @Post(':id/unposting')
  unpost(@Param('id', new ParseUUIDPipe()) id: string): Promise<WriteOff> {
    return this.writeOffs.unpost(id);
  }
}
