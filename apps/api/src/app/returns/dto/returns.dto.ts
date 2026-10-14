import type {
  CreateReturnRequest,
  PrescriptionKind,
  ReturnLineInput,
  ReturnPolicy,
  ReturnReason,
} from '@pharmacy/shared-dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PosOperationContextDto, ReceiptPaymentDto } from '../../pos/dto/pos.dto';

// Limits of spec 2026-10-13-customer-returns, section 4; the receipt, its lines, the shift and the
// money are checked by the services.
const MAX_MONEY_MINOR = 10_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASONS: ReturnReason[] = ['customer', 'defect'];

export class ReturnLineDto implements ReturnLineInput {
  @IsUUID()
  lineId!: string;

  /** In the sale unit of the line. */
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;
}

/** POST /api/v1/returns — online, `Idempotency-Key` = `id` (E1). */
export class CreateReturnDto
  extends PosOperationContextDto
  implements CreateReturnRequest
{
  @IsUUID()
  receiptId!: string;

  @IsUUID()
  shiftId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];

  @IsIn(REASONS)
  reason!: ReturnReason;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => ReceiptPaymentDto)
  refunds!: ReceiptPaymentDto[];

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  refundMinor!: number;

  /** The product of the search when the sale was found without the receipt (R8). */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  foundProductId!: string | null;
}

/** GET /api/v1/receipts/returnable?number= | ?id= [&productId=] */
export class ReturnableQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  number?: string;

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;
}

/** GET /api/v1/returns/sales-search?query=&date= */
export class SalesSearchQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  query!: string;

  @Matches(DATE)
  date!: string;
}

/** GET /api/v1/returns?storeId=&reason=&limit=&offset= */
export class ReturnListQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsIn(REASONS)
  reason?: ReturnReason;

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

export class CustomerReturnsDto implements Record<PrescriptionKind, boolean> {
  @IsBoolean()
  none!: boolean;

  @IsBoolean()
  rx!: boolean;

  @IsBoolean()
  controlled!: boolean;
}

/** PUT /api/v1/settings/returns */
export class ReturnPolicyDto implements ReturnPolicy {
  @IsInt()
  @Min(0)
  @Max(365)
  returnWindowDays!: number;

  @ValidateNested()
  @Type(() => CustomerReturnsDto)
  customerReturns!: CustomerReturnsDto;
}
