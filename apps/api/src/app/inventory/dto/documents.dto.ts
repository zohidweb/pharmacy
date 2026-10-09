import type {
  DocumentListQuery,
  DocumentStatus,
  GoodsReceiptInput,
  OpeningBalanceInput,
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

// Limits of spec 2026-10-09-inventory-purchasing, section 4.1. Products, the supplier, the store
// and the completeness of a document (at posting) are checked by the services.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_MONEY_MINOR = 10_000_000_000;
const MAX_PACKS = 100_000;
const MAX_LINES = 500;
const STATUSES: DocumentStatus[] = ['draft', 'posted'];

/** GET /api/v1/goods-receipts, GET /api/v1/opening-balances. */
export class DocumentListQueryDto implements DocumentListQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: DocumentStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

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

class StockLineBase {
  @IsUUID()
  productId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  batchNumber!: string;

  @Matches(DATE)
  expiresOn!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_PACKS)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  costMinor!: number;
}

export class GoodsReceiptLineDto extends StockLineBase {
  /** Set by the purchase orders (PR-2); null here. */
  @ValidateIf((line: GoodsReceiptLineDto) => line.orderPriceMinor !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  orderPriceMinor!: number | null;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  retailPriceMinor!: number;
}

/** POST /api/v1/goods-receipts, PUT /api/v1/goods-receipts/{id}. */
export class GoodsReceiptInputDto implements GoodsReceiptInput {
  @Matches(DATE)
  date!: string;

  @IsUUID()
  supplierId!: string;

  @IsUUID()
  storeId!: string;

  @ValidateIf((input: GoodsReceiptInputDto) => input.orderId !== null)
  @IsUUID()
  orderId!: string | null;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  invoiceNumber!: string;

  @ValidateIf((input: GoodsReceiptInputDto) => input.paymentDueOn !== null)
  @Matches(DATE)
  paymentDueOn!: string | null;

  @IsArray()
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}

export class OpeningBalanceLineDto extends StockLineBase {
  @ValidateIf((line: OpeningBalanceLineDto) => line.retailPriceMinor !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  retailPriceMinor!: number | null;

  @IsBoolean()
  starting!: boolean;
}

/** POST /api/v1/opening-balances, PUT /api/v1/opening-balances/{id}. */
export class OpeningBalanceInputDto implements OpeningBalanceInput {
  @Matches(DATE)
  date!: string;

  @IsUUID()
  storeId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment!: string;

  @IsArray()
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines!: OpeningBalanceLineDto[];
}
