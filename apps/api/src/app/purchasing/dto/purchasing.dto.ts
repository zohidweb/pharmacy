import type {
  SupplierInput,
  SupplierPaymentMethod,
  SupplierPaymentRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';

// Limits of spec 2026-10-09-inventory-purchasing, sections 5.1–5.2; the uniqueness of the name is
// checked by the service.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

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
  @Max(10_000_000_000)
  amountMinor!: number;

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  date!: string;

  @IsIn(['cash', 'bank'])
  method!: SupplierPaymentMethod;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;
}
