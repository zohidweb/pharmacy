import type { SupplierInput } from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Limits of spec 2026-10-09-inventory-purchasing, section 5.1; the uniqueness of the name is
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
