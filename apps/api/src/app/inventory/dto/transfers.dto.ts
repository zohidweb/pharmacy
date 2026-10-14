import type {
  AcceptTransferRequest,
  RejectionReason,
  RejectTransferRequest,
  SaleUnit,
  TransferInput,
  TransferRequestInput,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Limits of spec 2026-10-12-supplier-returns-transfers, section 5; the stores, the batches, the
// request and the unit of a line are checked by the services.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export const REJECTION_REASONS: RejectionReason[] = [
  'no_stock',
  'order_from_supplier',
  'other',
];

export class TransferRequestLineDto {
  @IsUUID()
  productId!: string;

  /** Packs. */
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;
}

/** POST /api/v1/transfer-requests, PUT /api/v1/transfer-requests/{id}. */
export class TransferRequestInputDto implements TransferRequestInput {
  @IsUUID()
  fromStoreId!: string;

  @IsUUID()
  toStoreId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;

  @IsBoolean()
  send!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TransferRequestLineDto)
  lines!: TransferRequestLineDto[];
}

/** POST /api/v1/transfer-requests/{id}/rejection. */
export class RejectTransferRequestDto implements RejectTransferRequest {
  @IsIn(REJECTION_REASONS)
  reason!: RejectionReason;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;
}

export class TransferLineDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  batchId!: string;

  @IsIn(['pack', 'piece'])
  unit!: SaleUnit;

  /** Packs or pieces, as `unit` says. */
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;
}

/** POST /api/v1/transfers, PUT /api/v1/transfers/{id}. */
export class TransferInputDto implements TransferInput {
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  requestId!: string | null;

  @IsUUID()
  fromStoreId!: string;

  @IsUUID()
  toStoreId!: string;

  @IsBoolean()
  send!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];
}

export class AcceptTransferLineDto {
  @IsUUID()
  batchId!: string;

  /** In the unit of the line. */
  @IsInt()
  @Min(0)
  @Max(100_000)
  receivedQuantity!: number;
}

/** POST /api/v1/transfers/{id}/acceptance. */
export class AcceptTransferDto implements AcceptTransferRequest {
  /** An instant: date, time and `Z` or an offset (`sentBy.at` of the card). */
  @IsISO8601({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/,
  )
  dispatchedAt!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AcceptTransferLineDto)
  lines!: AcceptTransferLineDto[];
}

/** GET /api/v1/transfers/overview. */
export class TransferOverviewQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;
}
