import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type {
  CloseStoreResponse,
  OwnerStore,
  StoreClosingPreview,
} from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../common/guards/decorators';
import { RequirePermission } from '../auth/decorators';
import { CloseStoreDto } from './dto/store-closing.dto';
import { StoreClosingService } from './store-closing.service';

// The closing of a store (spec 2026-10-15-store-closing, 5): destructive, so the closing and its
// cancellation ask for a fresh sign-in (E1).
@Controller({ path: 'stores', version: '1' })
export class StoreClosingController {
  constructor(private readonly closing: StoreClosingService) {}

  /** 403 `store_not_in_scope`; 409 `store_closing` / `store_closed` / `offline_store_read_only` / `last_store`. */
  @RequirePermission('stores:delete')
  @Get(':id/closing-preview')
  preview(@Param('id', new ParseUUIDPipe()) id: string): Promise<StoreClosingPreview> {
    return this.closing.preview(id);
  }

  /** As the preview, plus 409 `store_not_closable` (errors[]) and 422 `receiverStoreId`. */
  @RequirePermission('stores:delete')
  @RequireFreshAuth()
  @Post(':id/closing')
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CloseStoreDto,
  ): Promise<CloseStoreResponse> {
    return this.closing.close(id, body);
  }

  /** 200 `OwnerStore`; 409 `closing_partly_received` / `store_closed`; 404 — not closing. */
  @RequirePermission('stores:delete')
  @RequireFreshAuth()
  @Post(':id/closing/cancellation')
  cancel(@Param('id', new ParseUUIDPipe()) id: string): Promise<OwnerStore> {
    return this.closing.cancel(id);
  }
}
