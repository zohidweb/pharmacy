import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmployeeMe } from '@pharmacy/shared-dto';
import type { Response } from 'express';
import {
  Authenticated,
  RequireFreshAuth,
} from '../../common/guards/decorators';
import { ChangePasswordDto, UpdateMeDto } from './dto/me.dto';
import { MeService } from './me.service';
import {
  type SessionCookieEnv,
  setSessionCookie,
  cookieEnvFrom,
} from './session-cookie';

// The own profile of the signed-in employee (auth design 2026-10-02, section 6). Personal data of
// the employee himself, so the routes need a session but no catalog permission.
@Controller({ path: 'me', version: '1' })
export class MeController {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly me: MeService,
    config: ConfigService,
  ) {
    this.cookieEnv = cookieEnvFrom(config);
  }

  @Authenticated()
  @Get()
  get(): Promise<EmployeeMe> {
    return this.me.get();
  }

  /** Changes the interface language of the employee and of the current session. */
  @Authenticated()
  @Patch()
  update(@Body() body: UpdateMeDto): Promise<EmployeeMe> {
    return this.me.updateLocale(body.locale);
  }

  /**
   * 204 + the rotated session cookie; every other session of the employee ends. 401
   * 422 `invalid_current_password` (errors[{ field: 'currentPassword' }]) for a wrong current
   * password, 403 `fresh_auth_required`, 422 `password_policy`, 429 `login_locked` after 5 wrong
   * current passwords in 15 minutes.
   */
  @Authenticated()
  @RequireFreshAuth()
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { token, maxAgeSeconds } = await this.me.changePassword(
      body.currentPassword,
      body.newPassword,
    );
    setSessionCookie(res, token, maxAgeSeconds, this.cookieEnv);
  }
}
