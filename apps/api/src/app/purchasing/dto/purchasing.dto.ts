import type {
  PurchaseOrderInput,
  PurchaseOrderListQuery,
  SupplierInput,
  SupplierPaymentMethod,
  SupplierPaymentRequest,
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
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Limits of spec 2026-10-09-inventory-purchasing, sections 5.1–5.3; the uniqueness of the name is
// checked by the service.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_MONEY_MINOR = 10_000_000_000;

/** POST /api/v1/suppliers, PUT /api/v1/suppliers/{id}. */
export class SupplierInputDto implements SupplierInput {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  /** ИНН: 9 digits or empty. */
  @Transform(trim)
  @IsString()
  @Matches(/^([0-9]{9})?$/)
  taxId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  phone!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address!: string;

  @IsInt()
  @Min(0)
  @Max(365)
  paymentDelayDays!: number;
}

/** GET /api/v1/suppliers. */
export class SupplierListQueryDto {
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

/** POST /api/v1/suppliers/{id}/payments; the date in the future is rejected by the service. */
export class SupplierPaymentDto implements SupplierPaymentRequest {
  /** The idempotency key (UUIDv7 of the client). */
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsUUID()
  legalEntityId?: string;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  amountMinor!: number;

  @Matches(DATE)
  date!: string;

  @IsIn(['cash', 'bank'])
  method!: SupplierPaymentMethod;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;
}

export class PurchaseOrderLineDto {
  @IsUUID()
  productId!: string;

  /** Packs. */
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  priceMinor!: number;
}

/** POST /api/v1/purchase-orders, PUT /api/v1/purchase-orders/{id}. */
export class PurchaseOrderInputDto implements PurchaseOrderInput {
  @IsUUID()
  supplierId!: string;

  @IsUUID()
  storeId!: string;

  @ValidateIf((input: PurchaseOrderInputDto) => input.expectedOn !== null)
  @Matches(DATE)
  expectedOn!: string | null;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

/** GET /api/v1/purchase-orders. */
export class PurchaseOrderListQueryDto implements PurchaseOrderListQuery {
  @IsOptional()
  @IsIn(['draft', 'confirmed', 'partially_received', 'closed', 'open'])
  status?: PurchaseOrderListQuery['status'];

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;

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

/** GET /api/v1/purchase-orders/open. */
export class OpenPurchaseOrdersQueryDto {
  @IsUUID()
  supplierId!: string;
}
