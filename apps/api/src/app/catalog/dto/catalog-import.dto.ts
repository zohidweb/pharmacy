import {
  importLimits,
  productUnits,
  type ProductUnit,
} from '@pharmacy/shared-domain';
import type {
  CatalogImportRequest,
  CatalogImportRow,
  PrescriptionKind,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// The limits of the product card (CatalogProductInputDto) and of a category name (CategoryInputDto); the rules
// that need the network are checked by the service (spec 2026-10-20-data-import, section 5).
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const PRESCRIPTIONS: PrescriptionKind[] = ['none', 'rx', 'controlled'];
const MAX_PRICE_MINOR = 10_000_000_000;

export class CatalogImportRowDto implements CatalogImportRow {
  @IsInt()
  @Min(1)
  line!: number;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  nameRu!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  nameTj!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[0-9]{8,14}$/, { each: true })
  barcodes!: string[];

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  category!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  form!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  dosage!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  inn!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  manufacturer!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(2)
  countryCode!: string;

  @IsIn(productUnits)
  unit!: ProductUnit;

  @IsInt()
  @Min(1)
  @Max(10_000)
  piecesPerPack!: number;

  @IsBoolean()
  divisible!: boolean;

  @IsIn(PRESCRIPTIONS)
  prescription!: PrescriptionKind;

  @ValidateIf((row: CatalogImportRowDto) => row.maxPriceMinor !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_MINOR)
  maxPriceMinor!: number | null;

  @ValidateIf((row: CatalogImportRowDto) => row.markupPercent !== null)
  @IsInt()
  @Min(0)
  @Max(1000)
  markupPercent!: number | null;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minStockPacks!: number;
}

/** POST /api/v1/catalog-imports and /api/v1/catalog-imports/checks. */
export class CatalogImportRequestDto implements CatalogImportRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(importLimits.rows)
  @ValidateNested({ each: true })
  @Type(() => CatalogImportRowDto)
  rows!: CatalogImportRowDto[];
}
