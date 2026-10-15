import type {
  NotificationKind,
  UpdateNetworkSettingsRequest,
} from '@pharmacy/shared-dto';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

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
  sync_conflict!: boolean;

  @IsBoolean()
  license_expiring!: boolean;

  @IsBoolean()
  service_decided!: boolean;
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
}
