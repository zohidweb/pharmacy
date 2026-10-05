import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import type {
  OperatorActivationRequest,
  OperatorLoginRequest,
} from '@pharmacy/shared-dto';
import { IsString, MaxLength } from 'class-validator';

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
