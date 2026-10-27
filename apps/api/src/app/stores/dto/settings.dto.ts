import {
  posBufferBounds,
  prescriptionRetentionBounds,
} from '@pharmacy/shared-domain';
import type {
  NotificationKind,
  UpdateNetworkSettingsRequest,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Printable text: line breaks are kept (a printed line each), other control characters are not.
const FOOTER_TEXT = /^(?:[^\p{Cc}]|[\n\r\t])*$/u;

/** The text under the receipts per language (spec 2026-10-26-pilot-small-gaps, P1): empty — no footer. */
export class ReceiptFooterDto {
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @Matches(FOOTER_TEXT)
  ru!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @Matches(FOOTER_TEXT)
  tj!: string;
}

/** One switch per kind: a missing or unknown kind is 400 `validation_failed`, not a 500. */
export class NotificationSwitchesDto implements Record<
  NotificationKind,
  boolean
> {
  @IsBoolean()
  batch_expiring!: boolean;

  @IsBoolean()
  low_stock!: boolean;

  @IsBoolean()
  supplier_payment_due!: boolean;

  @IsBoolean()
  transfer_in_transit!: boolean;

  @IsBoolean()
  shift_discrepancy!: boolean;

  @IsBoolean()
  negative_stock!: boolean;

  @IsBoolean()
  receipt_discrepancy!: boolean;

  @IsBoolean()
  login_locked!: boolean;

  @IsBoolean()
  sync_conflict!: boolean;

  @IsBoolean()
  license_expiring!: boolean;

  @IsBoolean()
  service_decided!: boolean;

  @IsBoolean()
  invoice_overdue!: boolean;
}

/** PUT /settings (spec 2026-10-14-owner-cabinet, E14); the name of the network is not here. */
export class UpdateNetworkSettingsDto implements UpdateNetworkSettingsRequest {
  // the API keeps an idle session at least 5 minutes (SESSION_IDLE_TIMEOUT_MIN_SECONDS)
  @IsInt()
  @Min(5)
  @Max(240)
  posSessionTimeoutMinutes!: number;

  @IsInt()
  @Min(4)
  @Max(8)
  minPinLength!: number;

  @IsInt()
  @Min(1)
  @Max(365)
  expiryNoticeDays!: number;

  @IsBoolean()
  warnBelowCost!: boolean;

  @IsObject()
  @ValidateNested()
  @Type(() => NotificationSwitchesDto)
  notifications!: NotificationSwitchesDto;

  // spec 2026-10-21-pos-offline-limits, P2, P6 (bounds — @pharmacy/shared-domain; the ПКУ limits are not above the
  // general ones — the service)
  @IsInt()
  @Min(prescriptionRetentionBounds[0])
  @Max(prescriptionRetentionBounds[1])
  prescriptionRetentionDays!: number;

  @IsInt()
  @Min(posBufferBounds.maxHours[0])
  @Max(posBufferBounds.maxHours[1])
  posBufferMaxHours!: number;

  @IsInt()
  @Min(posBufferBounds.maxOperations[0])
  @Max(posBufferBounds.maxOperations[1])
  posBufferMaxOperations!: number;

  @IsInt()
  @Min(posBufferBounds.controlledMaxHours[0])
  @Max(posBufferBounds.controlledMaxHours[1])
  posControlledMaxHours!: number;

  @IsInt()
  @Min(posBufferBounds.controlledMaxOperations[0])
  @Max(posBufferBounds.controlledMaxOperations[1])
  posControlledMaxOperations!: number;

  @IsObject()
  @ValidateNested()
  @Type(() => ReceiptFooterDto)
  receiptFooter!: ReceiptFooterDto;
}
