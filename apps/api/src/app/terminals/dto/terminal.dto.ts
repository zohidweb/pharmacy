import { PIN_MAX_LENGTH } from '@pharmacy/shared-domain';
import type {
  BindTerminalRequest,
  PinLoginRequest,
} from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length, MaxLength } from 'class-validator';

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
