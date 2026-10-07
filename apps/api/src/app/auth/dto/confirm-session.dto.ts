import type { ConfirmSessionRequest } from '@pharmacy/shared-dto';
import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import { IsString, MaxLength } from 'class-validator';

/** POST /api/v1/sessions/current/confirmation (ADR-0008, amendment 2026-10-06). */
export class ConfirmSessionDto implements ConfirmSessionRequest {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
