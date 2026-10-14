import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OperatorMe, OperatorSessionInfo } from '@pharmacy/shared-dto';
import type { Response } from 'express';
import { ChangePasswordDto } from '../../auth/dto/me.dto';
import {
  cookieEnvFrom,
  type SessionCookieEnv,
  setOperatorCookie,
} from '../../auth/session-cookie';
import { RequireOperatorPermission } from './decorators';
import { UpdateOperatorMeDto } from './dto/operator.dto';
import { OperatorMeService } from './operator-me.service';

// The own profile of the signed-in operator (auth design 2026-10-02, section 9). Every operator
// holds platform:view; the routes act on the operator of the session only.
@Controller({ path: 'operator/me', version: '1' })
export class OperatorMeController {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly me: OperatorMeService,
    config: ConfigService,
  ) {
    this.cookieEnv = cookieEnvFrom(config);
  }

  @RequireOperatorPermission('platform:view')
  @Get()
  get(): Promise<OperatorMe> {
    return this.me.get();
  }

  /** The name and the interface language. */
  @RequireOperatorPermission('platform:view')
  @Patch()
  update(@Body() body: UpdateOperatorMeDto): Promise<OperatorMe> {
    return this.me.update(body.fullName, body.locale);
  }

  /**
   * 204 + the rotated session cookie; every other session of the operator ends. 422
   * `invalid_current_password` (errors[{ field: 'currentPassword' }]), 422 `password_policy`, 429
   * `login_locked` after 5 wrong current passwords in 15 minutes.
   */
  @RequireOperatorPermission('platform:view')
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
    setOperatorCookie(res, token, maxAgeSeconds, this.cookieEnv);
  }

  @RequireOperatorPermission('platform:view')
  @Get('sessions')
  sessions(): Promise<OperatorSessionInfo[]> {
    return this.me.sessionList();
  }

  @RequireOperatorPermission('platform:view')
  @Delete('sessions/others')
  @HttpCode(HttpStatus.NO_CONTENT)
  endOtherSessions(): Promise<void> {
    return this.me.endOtherSessions();
  }
}
