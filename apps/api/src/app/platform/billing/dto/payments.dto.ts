import type {
  CancelPaymentRequest,
  PaymentListQuery,
  PaymentMethod,
  RecordPaymentRequest,
  UpdatePaymentRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_MONEY_MINOR,
  optionalText,
  PRINTABLE_TEXT,
  ReasonDto,
} from './billing.dto';

const METHODS: PaymentMethod[] = ['bank_transfer', 'cash'];

/** Amount, day and method of a payment (spec 2026-10-15-billing-services, section 11). */
class PaymentFieldsDto {
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_MINOR)
  amountMinor!: number;

  /** A calendar date; the service refuses a future one. */
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidOn!: string;

  @IsIn(METHODS)
  method!: PaymentMethod;
}

/** POST /api/v1/operator/payments — `id` is the idempotency key made by the client (A9). */
export class RecordPaymentDto
  extends PaymentFieldsDto
  implements RecordPaymentRequest
{
  @IsUUID()
  id!: string;

  @IsUUID()
  tenantId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string | null;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @Length(1, 500)
  @Matches(PRINTABLE_TEXT)
  comment?: string | null;
}

/** PATCH /api/v1/operator/payments/{id} */
export class UpdatePaymentDto
  extends PaymentFieldsDto
  implements UpdatePaymentRequest
{
  @Transform(optionalText)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, 500)
  @Matches(PRINTABLE_TEXT)
  comment!: string | null;
}

/** POST /api/v1/operator/payments/{id}/cancellation */
export class CancelPaymentDto
  extends ReasonDto
  implements CancelPaymentRequest {}

/** GET /api/v1/operator/payments */
export class PaymentListQueryDto implements PaymentListQuery {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

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
