import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import type {
  OperatorActivationRequest,
  OperatorLoginRequest,
  UiLocale,
  UpdateMeRequest,
} from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, MaxLength } from 'class-validator';
import { uiLocales } from '../../../auth/dto/me.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// An e-mail (RFC 5321 path limit).
const LOGIN_MAX_LENGTH = 254;
// The displayed code is 26 characters in groups; the bound only caps the input size.
const CODE_MAX_LENGTH = 64;

/** POST /api/v1/operator/sessions. The password bound caps the cost of hashing (DoS). */
export class OperatorLoginDto implements OperatorLoginRequest {
  @IsString()
  @MaxLength(LOGIN_MAX_LENGTH)
  login!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

/** POST /api/v1/operator/activations. */
export class OperatorActivationDto implements OperatorActivationRequest {
  @IsString()
  @MaxLength(LOGIN_MAX_LENGTH)
  login!: string;

  @IsString()
  @MaxLength(CODE_MAX_LENGTH)
  code!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

/** PATCH /api/v1/operator/me. The name bound is the one of create-operator.mjs. */
export class UpdateOperatorMeDto implements UpdateMeRequest {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsIn(uiLocales)
  locale!: UiLocale;
}
