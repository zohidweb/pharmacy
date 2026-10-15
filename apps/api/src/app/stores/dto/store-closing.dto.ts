import type { CloseStoreRequest } from '@pharmacy/shared-dto';
import { IsUUID, ValidateIf } from 'class-validator';

/** POST /api/v1/stores/{id}/closing (spec 2026-10-15-store-closing, E3). */
export class CloseStoreDto implements CloseStoreRequest {
  /** Another active cloud store; `null` only for a store without stock. */
  @ValidateIf((body: CloseStoreDto) => body.receiverStoreId !== null)
  @IsUUID()
  receiverStoreId!: string | null;
}
