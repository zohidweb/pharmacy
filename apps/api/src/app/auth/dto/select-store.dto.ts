import type { SelectStoreRequest } from '@pharmacy/shared-dto';
import { IsUUID } from 'class-validator';

/** PUT /api/v1/sessions/current/store. */
export class SelectStoreDto implements SelectStoreRequest {
  @IsUUID()
  storeId!: string;
}
