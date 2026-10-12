import type {
  DocumentStatus,
  StockLineInput,
  WriteOffInput,
  WriteOffListQuery,
  WriteOffReason,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Limits of spec 2026-10-12-write-offs-stock-counts, section 4; the batch, the store and the unit
// of a line are checked by the service.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const WRITE_OFF_REASONS: WriteOffReason[] = [
  'expired',
  'broken',
  'defect',
  'misgrade',
  'transfer_discrepancy',
];
const STATUSES: DocumentStatus[] = ['draft', 'posted'];

export class WriteOffLineDto implements StockLineInput {
  @IsUUID()
  productId!: string;

  @IsUUID()
  batchId!: string;

  @IsIn(['pack', 'piece'])
  unit!: StockLineInput['unit'];

  /** Packs or pieces, as `unit` says. */
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;
}

/** POST /api/v1/write-offs, PUT /api/v1/write-offs/{id}. */
export class WriteOffInputDto implements WriteOffInput {
  @Matches(DATE)
  date!: string;

  @IsUUID()
  storeId!: string;

  @IsIn(WRITE_OFF_REASONS)
  reason!: WriteOffReason;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => WriteOffLineDto)
  lines!: WriteOffLineDto[];
}

/** GET /api/v1/write-offs. */
export class WriteOffListQueryDto implements WriteOffListQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsIn(WRITE_OFF_REASONS)
  reason?: WriteOffReason;

  @IsOptional()
  @IsIn(STATUSES)
  status?: DocumentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
