import { PIN_MAX_LENGTH } from '@pharmacy/shared-domain';
import type {
  BindTerminalRequest,
  ChangePinRequest,
  PinLoginRequest,
} from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

const TERMINAL_NAME_MAX_LENGTH = 60;

/** POST /api/v1/terminals. */
export class BindTerminalDto implements BindTerminalRequest {
  @IsUUID()
  storeId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, TERMINAL_NAME_MAX_LENGTH)
  name!: string;
}

/** POST /api/v1/terminal-sessions. The PIN bound caps the cost of hashing. */
export class PinLoginDto implements PinLoginRequest {
  @IsUUID()
  employeeId!: string;

  @IsString()
  @MaxLength(PIN_MAX_LENGTH)
  pin!: string;
}

/** POST /api/v1/me/pin. Bounds cap the cost of hashing; the PIN rules are checked by the service. */
export class ChangePinDto implements ChangePinRequest {
  @IsOptional()
  @IsString()
  @MaxLength(PIN_MAX_LENGTH)
  currentPin!: string | null;

  @IsString()
  @MaxLength(PIN_MAX_LENGTH)
  newPin!: string;
}
