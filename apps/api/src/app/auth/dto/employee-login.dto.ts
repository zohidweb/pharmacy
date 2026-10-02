import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import type { EmployeeLoginRequest } from '@pharmacy/shared-dto';
import { IsString, MaxLength } from 'class-validator';

// The longest identifier: an e-mail (RFC 5321 path limit).
const LOGIN_MAX_LENGTH = 254;

/** POST /api/v1/sessions. The password bound caps the cost of hashing (DoS). */
export class EmployeeLoginDto implements EmployeeLoginRequest {
  @IsString()
  @MaxLength(LOGIN_MAX_LENGTH)
  login!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
