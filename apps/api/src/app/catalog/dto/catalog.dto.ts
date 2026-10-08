import { productUnits, type ProductUnit } from '@pharmacy/shared-domain';
import type {
  CatalogFlag,
  CatalogListQuery,
  CatalogProductInput,
  CatalogStatus,
  CategoryInput,
  PrescriptionKind,
  UpdateCatalogStatusRequest,
  UpdateMarkupsRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Limits of spec 2026-10-07-catalog-pricing, section 5. Language, category, form, country and
// barcode ownership are checked by the services.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const FLAGS: CatalogFlag[] = ['rx', 'controlled', 'regulated', 'no_barcode'];
const STATUSES: CatalogStatus[] = ['active', 'archived'];
const PRESCRIPTIONS: PrescriptionKind[] = ['none', 'rx', 'controlled'];
const MAX_PRICE_MINOR = 10_000_000_000;

/** GET /api/v1/catalog/products. */
export class CatalogListQueryDto implements CatalogListQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  form?: string;

  @IsOptional()
  @IsIn(FLAGS)
  flag?: CatalogFlag;

  @IsOptional()
  @IsIn(STATUSES)
  status?: CatalogStatus;

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

export class BarcodeDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9]{8,14}$/)
  code!: string;
}

/** POST /api/v1/catalog/products, PUT /api/v1/catalog/products/{id}. */
export class CatalogProductInputDto implements CatalogProductInput {
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  nameRu!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  nameTj!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  inn!: string;

  @IsUUID()
  categoryId!: string;

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

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BarcodeDto)
  barcodes!: BarcodeDto[];

  @IsIn(PRESCRIPTIONS)
  prescription!: PrescriptionKind;

  @ValidateIf((input: CatalogProductInputDto) => input.maxPriceMinor !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_MINOR)
  maxPriceMinor!: number | null;

  @ValidateIf((input: CatalogProductInputDto) => input.markupPercent !== null)
  @IsInt()
  @Min(0)
  @Max(1000)
  markupPercent!: number | null;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minStockPacks!: number;
}

/** POST /api/v1/catalog/products/{id}/status, POST /api/v1/catalog/categories/{id}/status. */
export class CatalogStatusDto implements UpdateCatalogStatusRequest {
  @IsIn(STATUSES)
  status!: CatalogStatus;
}

/** POST /api/v1/catalog/categories, PUT /api/v1/catalog/categories/{id}. */
export class CategoryInputDto implements CategoryInput {
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  nameRu!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  nameTj!: string;
}

export class MarkupDto {
  @IsUUID()
  categoryId!: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  markupPercent!: number;
}

/** PUT /api/v1/settings/markups. */
export class UpdateMarkupsDto implements UpdateMarkupsRequest {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MarkupDto)
  markups!: MarkupDto[];
}
