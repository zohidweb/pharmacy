import { importLimits } from '@pharmacy/shared-domain';
import type {
  OpeningBalanceImportRequest,
  OpeningBalanceImportRow,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
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
import { IsCalendarDate } from '../../../common/validation/calendar-date';

// The limits of a line of opening balances (StockLineBase, OpeningBalanceLineDto) and of the barcodes of a card; the
// product and the store are checked by the service (spec 2026-10-20-data-import, section 5).
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const MAX_MONEY_MINOR = 10_000_000_000;
const MAX_PACKS = 100_000;

export class OpeningBalanceImportRowDto implements OpeningBalanceImportRow {
  @IsInt()
  @Min(1)
  line!: number;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[0-9]{8,14}$/, { each: true })
  barcodes!: string[];

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  name!: string;

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
  @MaxLength(60)
  batchNumber!: string;

  @IsCalendarDate()
  expiresOn!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_PACKS)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  costMinor!: number;

  @ValidateIf(
    (row: OpeningBalanceImportRowDto) => row.retailPriceMinor !== null,
  )
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  retailPriceMinor!: number | null;
}

/** POST /api/v1/opening-balance-imports and /api/v1/opening-balance-imports/checks. */
export class OpeningBalanceImportRequestDto implements OpeningBalanceImportRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsUUID()
  storeId!: string;

  @IsCalendarDate()
  date!: string;

  /** The comment of the drafts, in the language of the interface; ` (i/n)` is added (clarification У4). */
  @Transform(trim)
  @IsString()
  @MaxLength(450)
  comment!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(importLimits.rows)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceImportRowDto)
  rows!: OpeningBalanceImportRowDto[];
}
