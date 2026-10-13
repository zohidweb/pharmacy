import { PASSWORD_MAX_LENGTH } from '@pharmacy/shared-domain';
import type {
  ChangePasswordRequest,
  UiLocale,
  UpdateEmployeeMeRequest,
} from '@pharmacy/shared-dto';
import { IsIn, IsString, MaxLength } from 'class-validator';

/** UI locales of the contract (`UiLocale`); the type has no runtime value in shared-dto. */
export const uiLocales = ['ru', 'tg'] as const satisfies readonly UiLocale[];

/** Does not compile while the contract has a locale the list above does not name. */
export const UI_LOCALES_COMPLETE: [
  Exclude<UiLocale, (typeof uiLocales)[number]>,
] extends [never]
  ? true
  : false = true;

/** PATCH /api/v1/me. */
export class UpdateMeDto implements UpdateEmployeeMeRequest {
  @IsIn(uiLocales)
  locale!: UiLocale;
}

/**
 * POST /api/v1/me/password. Both bounds cap the cost of hashing (DoS); the policy of the new
 * password is checked by the service (422 `password_policy`).
 */
export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
