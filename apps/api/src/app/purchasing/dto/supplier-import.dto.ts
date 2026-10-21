import { importLimits } from '@pharmacy/shared-domain';
import type {
  SupplierImportRequest,
  SupplierImportRow,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// The limits of a supplier card (SupplierInputDto); a name the network has is skipped by the service (spec
// 2026-10-20-data-import, section 5).
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SupplierImportRowDto implements SupplierImportRow {
  @IsInt()
  @Min(1)
  line!: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

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

/** POST /api/v1/supplier-imports and /api/v1/supplier-imports/checks. */
export class SupplierImportRequestDto implements SupplierImportRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(importLimits.supplierRows)
  @ValidateNested({ each: true })
  @Type(() => SupplierImportRowDto)
  rows!: SupplierImportRowDto[];
}
