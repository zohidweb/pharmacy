import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import type { ActivationRequest } from '@pharmacy/shared-dto';
import { IsString, MaxLength } from 'class-validator';

// The longest identifier: an e-mail (RFC 5321 path limit).
const LOGIN_MAX_LENGTH = 254;
// A displayed code is 26 characters in 7 groups; the bound leaves room for spaces and only caps
// the input size.
const CODE_MAX_LENGTH = 64;

/** POST /api/v1/activations. The password bound caps the cost of hashing (DoS). */
export class ActivationDto implements ActivationRequest {
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
