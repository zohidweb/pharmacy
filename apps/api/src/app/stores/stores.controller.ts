import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { OwnerStore, StoresOverview } from '@pharmacy/shared-dto';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { isUuid } from '../../core/database';
import { RequirePermission } from '../auth/decorators';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { StoresService } from './stores.service';

// The optional Idempotency-Key header of POST /stores: a UUID, case-insensitive.
function idempotencyKeyOf(header: string | undefined): string | null {
  if (header === undefined || header === '') return null;
  if (!isUuid(header)) {
    throw new FieldProblemException(400, 'validation_failed', [
      { field: 'Idempotency-Key', code: 'uuid' },
    ]);
  }
  return header.toLowerCase();
}

// Stores of the owner cabinet (spec 2026-10-06-owner-stores, section 3).
@Controller({ path: 'stores', version: '1' })
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  /** The stores of the employee's scope, active first. */
  @RequirePermission('stores:view')
  @Get()
  overview(): Promise<StoresOverview> {
    return this.stores.overview();
  }

  /** 201 `OwnerStore`; 404, 409 `store_code_taken` / `tax_id_taken`. */
  @RequirePermission('stores:create')
  @Post()
  create(
    @Body() body: CreateStoreDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OwnerStore> {
    return this.stores.create(body, idempotencyKeyOf(idempotencyKey));
  }

  /** 404 (outside the scope), 409 `store_closed`. */
  @RequirePermission('stores:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateStoreDto,
  ): Promise<OwnerStore> {
    return this.stores.update(id, body);
  }
}
