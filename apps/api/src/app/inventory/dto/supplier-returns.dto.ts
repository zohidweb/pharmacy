import type {
  DocumentStatus,
  StockLineInput,
  SupplierReturnInput,
  SupplierReturnListQuery,
  SupplierReturnReason,
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
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/calendar-date';

// Limits of spec 2026-10-12-supplier-returns-transfers, section 4; the batch, its supplier, the
// store and the unit of a line are checked by the service.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export const SUPPLIER_RETURN_REASONS: SupplierReturnReason[] = [
  'defect',
  'expired',
  'broken',
];
const STATUSES: DocumentStatus[] = ['draft', 'posted'];

export class SupplierReturnLineDto implements StockLineInput {
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

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note!: string;
}

/** POST /api/v1/supplier-returns, PUT /api/v1/supplier-returns/{id}. */
export class SupplierReturnInputDto implements SupplierReturnInput {
  @IsCalendarDate()
  date!: string;

  @IsUUID()
  supplierId!: string;

  @IsUUID()
  storeId!: string;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  receiptId!: string | null;

  @IsIn(SUPPLIER_RETURN_REASONS)
  reason!: SupplierReturnReason;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnLineDto)
  lines!: SupplierReturnLineDto[];
}

/** GET /api/v1/supplier-returns. */
export class SupplierReturnListQueryDto implements SupplierReturnListQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsIn(SUPPLIER_RETURN_REASONS)
  reason?: SupplierReturnReason;

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
