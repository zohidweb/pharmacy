import type {
  CreateReceiptRequest,
  ReceiptPaymentMethod,
  CashInReason,
  CashMovementKind,
  CashMovementRequest,
  CashOutReason,
  CloseShiftRequest,
  ForceCloseShiftRequest,
  HoldReceiptRequest,
  OpenShiftRequest,
  PosOperationContext,
  SaleUnit,
  ShiftListQuery,
  ShiftStatus,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../../common/validation/calendar-date';

// Limits of spec 2026-10-13-pos-shift-sale, sections 4.4–4.6; the shift, the terminal, the author,
// the products and the batches are checked by the services.
const MAX_MONEY_MINOR = 10_000_000_000;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** GET /api/v1/stores/{storeId}/catalog-snapshot?sinceVersion= */
export class CatalogSnapshotQueryDto {
  /** Version of the stored snapshot: only the products changed since come back. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sinceVersion?: number;
}

/** The context of every buffered operation (ADR-0015): the id is also the Idempotency-Key. */
export class PosOperationContextDto implements PosOperationContext {
  @IsUUID()
  id!: string;

  @IsUUID()
  storeId!: string;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  terminalId!: string | null;

  @IsUUID()
  employeeId!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;
}

/** POST /api/v1/shifts */
export class OpenShiftDto
  extends PosOperationContextDto
  implements OpenShiftRequest
{
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  openingCashMinor!: number;
}

const CASH_REASONS: Array<CashInReason | CashOutReason> = [
  'change_fund',
  'other',
  'collection',
  'expense',
];

/** POST /api/v1/shifts/{id}/cash-movements */
export class CashMovementDto
  extends PosOperationContextDto
  implements CashMovementRequest
{
  @IsUUID()
  shiftId!: string;

  @IsIn(['in', 'out'])
  kind!: CashMovementKind;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  amountMinor!: number;

  /** `in`: change_fund / other; `out`: collection / expense — the pair is checked by the service. */
  @IsIn(CASH_REASONS)
  reason!: CashInReason | CashOutReason;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  comment!: string;
}

/**
 * The bank terminal of a kind over the shift: its sales less its refunds — negative when the returns
 * paid back by the kind exceed the sales of the shift (spec 2026-10-13-customer-returns, E13).
 */
export class TerminalTotalsDto {
  @IsInt()
  @Min(-MAX_MONEY_MINOR)
  @Max(MAX_MONEY_MINOR)
  card!: number;

  @IsInt()
  @Min(-MAX_MONEY_MINOR)
  @Max(MAX_MONEY_MINOR)
  qr!: number;

  @IsInt()
  @Min(-MAX_MONEY_MINOR)
  @Max(MAX_MONEY_MINOR)
  nfc!: number;
}

const SHIFT_STATUSES: ShiftStatus[] = ['open', 'closed'];

/** GET /api/v1/shifts — the shift history (plan 2026-10-27-shift-history, S1). */
export class ShiftListQueryDto implements ShiftListQuery {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @IsOptional()
  @IsIn(SHIFT_STATUSES)
  status?: ShiftStatus;

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

/** POST /api/v1/shifts/{id}/closure */
export class CloseShiftDto
  extends PosOperationContextDto
  implements CloseShiftRequest
{
  @IsUUID()
  shiftId!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  actualCashMinor!: number;

  /** May be empty at a discrepancy: the closing is a fact (E24). */
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  discrepancyReason!: string;

  // required: @ValidateNested lets a missing object through, and the service reads it
  @IsObject()
  @ValidateNested()
  @Type(() => TerminalTotalsDto)
  terminalTotals!: TerminalTotalsDto;
}

export class HeldLineDto {
  @IsUUID()
  productId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  productName!: string;

  @IsUUID()
  batchId!: string;

  @IsIn(['pack', 'piece'])
  unit!: SaleUnit;

  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  unitPriceMinor!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  amountMinor!: number;
}

/** POST /api/v1/held-receipts — online only, not through the buffer (E12). */
export class HoldReceiptDto implements HoldReceiptRequest {
  @IsUUID()
  id!: string;

  @IsUUID()
  storeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => HeldLineDto)
  lines!: HeldLineDto[];

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  subtotalMinor!: number;
}

/** ПКУ data of a line: every field optional (K3). */
export class ControlledSaleDataDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  prescriptionNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10)
  prescriptionDate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  clinic?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  doctor?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  buyerName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  buyerDocument?: string;
}

export class ReceiptLineDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  batchId!: string;

  @IsIn(['pack', 'piece'])
  unit!: SaleUnit;

  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  unitPriceMinor!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  amountMinor!: number;

  /** The value of the POS snapshot (E23). */
  @IsInt()
  @Min(1)
  @Max(100_000)
  piecesPerPack!: number;

  @IsBoolean()
  batchChosenManually!: boolean;

  // required, null without ПКУ data: a missing field is 400, not a line taken for a ПКУ one without data
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => ControlledSaleDataDto)
  controlled!: ControlledSaleDataDto | null;
}

export class ReceiptPaymentDto {
  @IsIn(['cash', 'card', 'qr', 'nfc'])
  method!: ReceiptPaymentMethod;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  amountMinor!: number;
}

/** POST /api/v1/receipts — the arithmetic is checked by the service (4.5). */
export class CreateReceiptDto
  extends PosOperationContextDto
  implements CreateReceiptRequest
{
  // the number of the receipt of the terminal within its shift (spec 2026-10-21-pos-offline-limits, P12)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999999)
  localNumber?: number;

  @IsUUID()
  shiftId!: string;

  @IsInt()
  @Min(0)
  priceListVersion!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  subtotalMinor!: number;

  /** `<ruleId>:<minSubtotalMinor>` of the snapshot (E9). */
  @ValidateIf((_, value) => value !== null)
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/i)
  discountRuleId!: string | null;

  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  discountMinSubtotalMinor!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  discountMinor!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  totalMinor!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => ReceiptPaymentDto)
  payments!: ReceiptPaymentDto[];

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  cashTenderedMinor!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  changeMinor!: number;

  @IsIn(['ru', 'tj'])
  language!: 'ru' | 'tj';
}

/** POST /api/v1/shifts/{id}/forced-closure — a manager closes the shift of another till (plan 2026-10-27-shift-history, S3). */
export class ForceCloseShiftDto implements ForceCloseShiftRequest {
  /** UUIDv7 of the operation = `Idempotency-Key`. */
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_MINOR)
  actualCashMinor!: number;

  // the same range as at a closing of the till: returns paid back by a kind may exceed its sales
  @IsObject()
  @ValidateNested()
  @Type(() => TerminalTotalsDto)
  terminalTotals!: TerminalTotalsDto;

  /** Required: why the shift is closed from another computer. */
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  reason!: string;
}
